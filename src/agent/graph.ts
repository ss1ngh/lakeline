import { prisma } from "../lib/prisma";
import { classifyIntentNode } from "./nodes/classify";
import { strategyNode } from "./nodes/strategy";
import { constraintNode } from "./nodes/constraint";
import { toolNode } from "./nodes/tools";
import { responseNode } from "./nodes/response";
import { fallbackNode } from "./nodes/fallback";
import { evaluationNode } from "./nodes/evaluation";
import { terminationNode } from "./nodes/termination";
import { scheduleFollowUp } from "../lib/queue";
import { withTimeout, LLMTimeoutError, RetryableError, FatalError } from "../lib/llm-timeout";
import { shouldSkipLLM, recordLLMFailure, recordLLMSuccess } from "../lib/circuit-breaker";

interface JobPayload {
  borrowerId: string;
  messageId: string;
  content?: string;
  systemMessage?: string;
}

interface AgentStateType {
  messages: Array<{ role: string; content: string }>;
  borrowerId: string;
  borrowerName: string;
  totalDebt: number;
  minimumAccept: number;
  currentStatus: string;
  intent: string;
  sentiment: string;
  strategy: string;
  constraintResult: Record<string, unknown>;
  toolResults: unknown[];
  response: string;
  iterationCount: number;
  maxIterations: number;
  isResolved: boolean;
  lastToolSuccess: boolean;
  negotiationHistory: {
    offers: number[];
    lastOffer?: number;
    accepted?: boolean;
    rejected?: boolean;
    rejectionCount: number;
  };
  retryCount: {
    classify: number;
    tool: number;
  };
  nextActionAt?: Date;
  lastAction: string | null;
}

interface Phase1Result {
  duplicate: boolean;
  borrower?: {
    id: string;
    name: string;
    totalDebt: number;
    minimumAccept: number;
    status: string;
  };
  state?: {
    intent: string;
    sentiment: string;
    strategy: string;
    iterationCount: number;
    lastAction: string | null;
    nextActionAt: Date | null;
    negotiationData: Record<string, unknown>;
    retryData: Record<string, unknown>;
  };
  messages?: Array<{ role: string; content: string }>;
}

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }));
}

function buildState(
  borrower: { id: string; name: string; totalDebt: number; minimumAccept: number; status: string },
  dbState: { intent: string; sentiment: string; strategy: string; iterationCount: number; lastAction: string | null; nextActionAt: Date | null; negotiationData: Record<string, unknown>; retryData: Record<string, unknown> } | null | undefined,
  messages: Array<{ role: string; content: string }>
): AgentStateType {
  const negotiationData = (dbState?.negotiationData || {}) as Record<string, unknown>;
  const retryData = (dbState?.retryData || {}) as Record<string, unknown>;

  return {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    borrowerId: borrower.id,
    borrowerName: borrower.name,
    totalDebt: borrower.totalDebt,
    minimumAccept: borrower.minimumAccept,
    currentStatus: borrower.status,
    intent: dbState?.intent || "UNKNOWN",
    sentiment: dbState?.sentiment || "NEUTRAL",
    strategy: dbState?.strategy || "",
    constraintResult: {},
    toolResults: [],
    response: "",
    iterationCount: dbState?.iterationCount || 0,
    maxIterations: 3,
    isResolved: false,
    lastToolSuccess: true,
    negotiationHistory: {
      offers: (negotiationData.offers as number[]) || [],
      lastOffer: negotiationData.lastOffer as number | undefined,
      accepted: negotiationData.accepted as boolean | undefined,
      rejected: negotiationData.rejected as boolean | undefined,
      rejectionCount: (negotiationData.rejectionCount as number) || 0,
    },
    retryCount: {
      classify: (retryData.classify as number) || 0,
      tool: (retryData.tool as number) || 0,
    },
    nextActionAt: dbState?.nextActionAt || undefined,
    lastAction: dbState?.lastAction || null,
  };
}

async function savePhase3(
  borrowerId: string,
  messageId: string,
  state: AgentStateType,
  response: string
): Promise<boolean> {
  let committed = false;
  await prisma.$transaction(async (tx) => {
    await tx.agentState.upsert({
      where: { borrowerId },
      update: {
        intent: state.intent,
        sentiment: state.sentiment,
        strategy: state.strategy,
        iterationCount: state.iterationCount,
        lastAction: state.lastAction,
        nextActionAt: state.nextActionAt ?? null,
        negotiationData: state.negotiationHistory,
      },
      create: {
        borrowerId,
        intent: state.intent,
        sentiment: state.sentiment,
        strategy: state.strategy,
        iterationCount: state.iterationCount,
        lastAction: state.lastAction,
        nextActionAt: state.nextActionAt ?? null,
        negotiationData: state.negotiationHistory,
      },
    });

    await tx.conversationMessage.create({
      data: { borrowerId, role: "AGENT", content: response },
    });

    await tx.processedMessage.upsert({
      where: { id: messageId },
      update: { status: "DONE" },
      create: { id: messageId, borrowerId, status: "DONE" },
    });
    committed = true;
  });
  return committed;
}

export async function runAgent(input: JobPayload): Promise<string> {
  const startTime = Date.now();
  const { borrowerId, messageId, content, systemMessage } = input;

  log("agent_start", { borrowerId, messageId, content: content?.substring(0, 50), systemMessage });

  let shouldScheduleFollowUp = false;

  try {
    const phase1Start = Date.now();
    const phase1 = await prisma.$transaction(async (tx): Promise<Phase1Result> => {
      const existing = await tx.processedMessage.findUnique({
        where: { id: messageId },
      });

      if (existing?.status === "DONE") {
        return { duplicate: true };
      }

      await tx.processedMessage.upsert({
        where: { id: messageId },
        update: { status: "PROCESSING", content: content ?? null, systemMessage: systemMessage ?? null },
        create: { id: messageId, borrowerId, status: "PROCESSING", content: content ?? null, systemMessage: systemMessage ?? null },
      });

      if (content || systemMessage) {
        await tx.conversationMessage.create({
          data: {
            borrowerId,
            role: systemMessage ? "SYSTEM" : "USER",
            content: systemMessage || content || "",
          },
        });
      }

      const borrower = await tx.borrower.findUnique({
        where: { id: borrowerId },
      });

      if (!borrower) {
        throw new Error("Borrower not found");
      }

      const dbState = await tx.agentState.findUnique({
        where: { borrowerId },
      });

      const messages = await tx.conversationMessage.findMany({
        where: { borrowerId },
        orderBy: { createdAt: "asc" },
        take: 10,
      });

      return {
        duplicate: false,
        borrower: {
          id: borrower.id,
          name: borrower.name,
          totalDebt: borrower.totalDebt,
          minimumAccept: borrower.minimumAccept,
          status: borrower.status,
        },
        state: dbState
          ? {
              intent: dbState.intent,
              sentiment: dbState.sentiment,
              strategy: dbState.strategy,
              iterationCount: dbState.iterationCount,
              lastAction: dbState.lastAction,
              nextActionAt: dbState.nextActionAt,
              negotiationData: dbState.negotiationData as Record<string, unknown>,
              retryData: dbState.retryData as Record<string, unknown>,
            }
          : undefined,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      };
    });

    log("phase1_time", { duration: Date.now() - phase1Start });

    if (phase1.duplicate) {
      log("duplicate", { borrowerId, messageId });
      return "Duplicate message ignored";
    }

    if (!phase1.borrower) {
      log("error", { borrowerId, error: "Borrower not found" });
      return "Borrower not found";
    }

    let state = buildState(
      phase1.borrower,
      phase1.state,
      phase1.messages || []
    ) as any;

    if (systemMessage && systemMessage.includes("FOLLOW_UP")) {
      state.intent = "DELAY";
    }

    const classifyStart = Date.now();
    if (shouldSkipLLM()) {
      log("llm_circuit_open", { borrowerId, messageId });
    } else {
      try {
        const classifyResult = await withTimeout(classifyIntentNode(state), 10000);
        state = { ...state, ...classifyResult };
        recordLLMSuccess();
      } catch (err: any) {
        if (err instanceof LLMTimeoutError) {
          recordLLMFailure();
          log("llm_timeout", { borrowerId, node: "classify" });
        }
        throw err;
      }
    }
    log("classify_latency", { duration: Date.now() - classifyStart });

    if (state.lastAction === "OFFER_SENT") {
      if (state.intent === "PAY_FULL") {
        state.strategy = "ACCEPT_FULL";
      } else if (state.intent === "REFUSE" || state.intent === "PAY_PARTIAL") {
        state.strategy = "NEGOTIATE_COUNTER";
      } else if (state.intent === "DELAY") {
        state.strategy = "FOLLOW_UP";
      }
    } else {
      const strategyResult = strategyNode(state);
      state = { ...state, ...strategyResult };
    }

    const constraintResult = constraintNode(state);
    state = { ...state, ...constraintResult };

    if (state.strategy === "FOLLOW_UP") {
      const nextActionAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      state = {
        ...state,
        nextActionAt,
        lastAction: "WAITING_RESPONSE",
        isResolved: false,
      };
    } else {
      const toolStart = Date.now();
      if (shouldSkipLLM()) {
        log("llm_circuit_open", { borrowerId, node: "tool" });
      } else {
        try {
          const toolResult = await withTimeout(toolNode(state), 15000);
          state = { ...state, ...toolResult };
          recordLLMSuccess();
        } catch (err: any) {
          if (err instanceof LLMTimeoutError) {
            recordLLMFailure();
            log("llm_timeout", { borrowerId, node: "tool" });
          }
          throw err;
        }
      }
      log("tool_latency", { duration: Date.now() - toolStart });
    }

    log("agent_tool_executed", {
      borrowerId,
      strategy: state.strategy,
      lastAction: state.lastAction,
    });

    let agentResponse = "";

    if (state.lastAction === "OFFER_SENT") {
      const responseStart = Date.now();
      if (shouldSkipLLM()) {
        log("llm_circuit_open", { borrowerId, node: "response" });
      } else {
        try {
          const responseResult = await withTimeout(responseNode(state), 10000);
          state = { ...state, ...responseResult };
          recordLLMSuccess();
        } catch (err: any) {
          if (err instanceof LLMTimeoutError) {
            recordLLMFailure();
            log("llm_timeout", { borrowerId, node: "response" });
          }
          throw err;
        }
      }
      log("response_latency", { duration: Date.now() - responseStart });
      agentResponse = state.response;

      const phase3Start = Date.now();
      const phase3Committed = await savePhase3(borrowerId, messageId, state, agentResponse);
      log("phase3_time", { duration: Date.now() - phase3Start });

      if (phase3Committed && state.nextActionAt) {
        await scheduleFollowUp(borrowerId, state.nextActionAt);
      }

      log("agent_resolved", { borrowerId, strategy: state.strategy });
      return agentResponse;
    }

    const evaluationResult = evaluationNode(state);
    state = { ...state, ...evaluationResult };

    if (state.isResolved) {
      if (state.strategy === "LLM_FALLBACK") {
        if (shouldSkipLLM()) {
          log("llm_circuit_open", { borrowerId, node: "fallback" });
        } else {
          try {
            const fallbackResult = await withTimeout(fallbackNode(state), 10000);
            state = { ...state, ...fallbackResult };
            recordLLMSuccess();
          } catch (err: any) {
            if (err instanceof LLMTimeoutError) {
              recordLLMFailure();
            }
            throw err;
          }
        }
      } else if (state.strategy === "FOLLOW_UP") {
        shouldScheduleFollowUp = true;
      } else {
        if (shouldSkipLLM()) {
          log("llm_circuit_open", { borrowerId, node: "response" });
        } else {
          try {
            const responseResult = await withTimeout(responseNode(state), 10000);
            state = { ...state, ...responseResult };
            recordLLMSuccess();
          } catch (err: any) {
            if (err instanceof LLMTimeoutError) {
              recordLLMFailure();
            }
            throw err;
          }
        }
      }
    } else if (state.strategy === "ESCALATE" || state.iterationCount >= 3) {
      if (shouldSkipLLM()) {
        log("llm_circuit_open", { borrowerId, node: "termination" });
      } else {
        try {
          const terminationResult = await withTimeout(terminationNode(state), 10000);
          state = { ...state, ...terminationResult };
          recordLLMSuccess();
        } catch (err: any) {
          if (err instanceof LLMTimeoutError) {
            recordLLMFailure();
          }
          throw err;
        }
      }
    } else if (!state.lastToolSuccess) {
      const constraintResult2 = constraintNode(state);
      state = { ...state, ...constraintResult2 };
      const toolResult2 = await withTimeout(toolNode(state), 15000);
      state = { ...state, ...toolResult2 };
    }

    agentResponse = state.response || "Thank you. We'll be in touch.";

    if (agentResponse) {
      const phase3Start = Date.now();
      const phase3Committed = await savePhase3(borrowerId, messageId, state, agentResponse);
      log("phase3_time", { duration: Date.now() - phase3Start });

      if (phase3Committed && shouldScheduleFollowUp && state.nextActionAt) {
        await scheduleFollowUp(borrowerId, state.nextActionAt);
      }
    }

    log("agent_complete", {
      borrowerId,
      strategy: state.strategy,
      resolved: state.isResolved,
      total_time: Date.now() - startTime,
    });
    return agentResponse;

  } catch (error: any) {
    console.error("[Agent] Error:", error);

    const isRetryable = error instanceof RetryableError;

    await prisma.processedMessage.upsert({
      where: { id: messageId },
      update: { status: isRetryable ? "PROCESSING" : "FAILED" },
      create: { id: messageId, borrowerId, status: isRetryable ? "PROCESSING" : "FAILED", content: content ?? null, systemMessage: systemMessage ?? null },
    });

    log("agent_error", {
      borrowerId,
      messageId,
      error: String(error),
      errorType: error?.constructor?.name || "Error",
      retryable: isRetryable,
      total_time: Date.now() - startTime,
    });

    if (isRetryable) {
      log("retry_scheduled", { borrowerId, messageId, errorType: error?.constructor?.name });
      throw new RetryableError(error.message || "Operation failed - will be retried");
    }

    return "An error occurred. Please try again.";
  }
}