import { prisma } from "../lib/prisma";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";

import { classifyIntentNode } from "./nodes/classify";
import { reasoningNode } from "./nodes/reasoning";
import { toolNode } from "./nodes/tools";
import { evaluationNode } from "./nodes/evaluation";
import { greetingNode } from "./nodes/greeting";

import { scheduleFollowUp } from "../lib/queue";

import {
  withTimeout,
  LLMTimeoutError,
  RetryableError,
} from "../lib/llm-timeout";

import {
  shouldSkipLLM,
  recordLLMFailure,
  recordLLMSuccess,
  resetCircuitBreaker,
} from "../lib/circuit-breaker";

/* -------------------------------------------------------------------------- */
/* TYPES */
/* -------------------------------------------------------------------------- */

interface JobPayload {
  borrowerId: string;
  messageId: string;
  content?: string;
  systemMessage?: string;
}

type LastAction = "WAITING_RESPONSE" | "RESOLVED" | "OFFER_SENT" | null;

interface AgentState {
  messages: BaseMessage[];

  borrowerId: string;
  borrowerName: string;
  totalDebt: number;
  minimumAccept: number;
  currentStatus: string;

  strategy: string;
  response: string;

  borrowerProposedAmount?: number;
  borrowerAnchorCount: number;
  lastBorrowerAmount?: number;

  negotiationHistory: {
    offers: number[];
    lastOffer?: number;
    accepted?: boolean;
    rejected?: boolean;
    rejectionCount: number;
  };

  toolResults: any[];
  lastToolSuccess: boolean;

  isResolved: boolean;
  lastAction: LastAction;
  nextActionAt?: Date;
}

/* -------------------------------------------------------------------------- */
/* LOGGING */
/* -------------------------------------------------------------------------- */

function log(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }),
  );
}

/* -------------------------------------------------------------------------- */
/* STATE BUILDER */
/* -------------------------------------------------------------------------- */

function buildState(
  borrower: any,
  messages: Array<{ role: string; content: string }>,
): AgentState {
  const langMessages: BaseMessage[] = messages.map((m) => {
    if (m.role === "USER") return new HumanMessage(m.content);
    if (m.role === "AGENT") return new AIMessage(m.content);
    return new SystemMessage(m.content);
  });

  return {
    messages: langMessages,

    borrowerId: borrower.id,
    borrowerName: borrower.name,
    totalDebt: borrower.totalDebt,
    minimumAccept: borrower.minimumAccept,
    currentStatus: borrower.status,

    strategy: "",
    response: "",

    borrowerProposedAmount: undefined,
    borrowerAnchorCount: 0,
    lastBorrowerAmount: undefined,

    negotiationHistory: {
      offers: [],
      lastOffer: undefined,
      accepted: false,
      rejected: false,
      rejectionCount: 0,
    },

    toolResults: [],
    lastToolSuccess: true,

    isResolved: false,
    lastAction: null,
    nextActionAt: undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* STATE NORMALIZER */
/* -------------------------------------------------------------------------- */

function normalizeState(state: AgentState): AgentState {
  // Prevent legacy leakage
  if (state.lastAction === "OFFER_SENT") {
    state.lastAction = "WAITING_RESPONSE";
  }

  return state;
}

/* -------------------------------------------------------------------------- */
/* SAVE */
/* -------------------------------------------------------------------------- */

async function savePhase3(
  borrowerId: string,
  messageId: string,
  response: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.conversationMessage.create({
      data: {
        borrowerId,
        role: "AGENT",
        content: response,
      },
    });

    await tx.processedMessage.upsert({
      where: { id: messageId },
      update: { status: "DONE" },
      create: {
        id: messageId,
        borrowerId,
        status: "DONE",
      },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* MAIN */
/* -------------------------------------------------------------------------- */

export async function runAgent(input: JobPayload): Promise<string> {
  const { borrowerId, messageId, content, systemMessage } = input;
  const startTime = Date.now();

  log("agent_start", {
    borrowerId,
    messageId,
    preview: content?.slice(0, 50),
  });

  try {
    /* -------------------------- PHASE 1: DB LOAD -------------------------- */

    const phase1 = await prisma.$transaction(async (tx) => {
      const existing = await tx.processedMessage.findUnique({
        where: { id: messageId },
      });

      if (existing?.status === "DONE") {
        return { duplicate: true };
      }

      await tx.processedMessage.upsert({
        where: { id: messageId },
        update: { status: "PROCESSING" },
        create: {
          id: messageId,
          borrowerId,
          status: "PROCESSING",
        },
      });

      if (content && systemMessage !== "<INITIATE_OUTBOUND_GREETING>") {
        await tx.conversationMessage.create({
          data: {
            borrowerId,
            role: "USER",
            content,
          },
        });
      }

      const borrower = await tx.borrower.findUnique({
        where: { id: borrowerId },
      });

      if (!borrower) throw new Error("Borrower not found");

      const messages = await tx.conversationMessage.findMany({
        where: { borrowerId },
        orderBy: { createdAt: "asc" },
        take: 20,
      });

      return {
        duplicate: false,
        borrower,
        messages,
      };
    });

    if (phase1.duplicate) return "Duplicate ignored";

    const messagesSafe = phase1.messages ?? [];

    let state: AgentState = buildState(
      phase1.borrower,
      messagesSafe.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    );

    resetCircuitBreaker();

    /* -------------------------- GREETING FLOW -------------------------- */

    if (systemMessage === "<INITIATE_OUTBOUND_GREETING>") {
      const greeting = await withTimeout(greetingNode(state as any), 20000);

      state = normalizeState({ ...state, ...greeting });

      await savePhase3(borrowerId, messageId, state.response);
      return state.response;
    }

    /* -------------------------- STEP 1: PARSE -------------------------- */

    if (!shouldSkipLLM()) {
      try {
        const parsed = await withTimeout(
          classifyIntentNode(state as any),
          15000,
        );
        state = normalizeState({ ...state, ...parsed });
        recordLLMSuccess();
      } catch (err) {
        if (err instanceof LLMTimeoutError) recordLLMFailure();
        throw err;
      }
    }

    /* -------------------------- STEP 2: REASON -------------------------- */

    if (!shouldSkipLLM()) {
      try {
        const reasoning = await withTimeout(reasoningNode(state as any), 25000);
        state = normalizeState({ ...state, ...reasoning });
        recordLLMSuccess();
      } catch (err) {
        if (err instanceof LLMTimeoutError) recordLLMFailure();
        throw err;
      }
    }

    /* -------------------------- STEP 3: TOOL -------------------------- */

    try {
      const toolResult = await withTimeout(toolNode(state as any), 10000);
      state = normalizeState({ ...state, ...toolResult });
    } catch (err) {
      log("tool_error", { error: String(err) });
    }

    /* -------------------------- STEP 4: EVAL -------------------------- */

    const evalResult = evaluationNode(state as any);
    state = normalizeState({ ...state, ...evalResult });

    /* -------------------------- FOLLOW-UP -------------------------- */

    if (!state.isResolved) {
      state.nextActionAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await scheduleFollowUp(borrowerId, state.nextActionAt);
    }

    /* -------------------------- FINAL RESPONSE -------------------------- */

    const response =
      state.response ||
      `Let’s work out a plan that fits you, ${state.borrowerName}.`;

    await savePhase3(borrowerId, messageId, response);

    log("agent_complete", {
      borrowerId,
      resolved: state.isResolved,
      duration: Date.now() - startTime,
    });

    return response;
  } catch (error: any) {
    console.error("[Agent Error]", error);

    const retryable = error instanceof RetryableError;

    await prisma.processedMessage.upsert({
      where: { id: messageId },
      update: { status: retryable ? "PROCESSING" : "FAILED" },
      create: {
        id: messageId,
        borrowerId,
        status: retryable ? "PROCESSING" : "FAILED",
      },
    });

    if (retryable) throw error;

    return "Something went wrong. Please try again.";
  }
}
