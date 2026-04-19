import { SystemMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { llm } from "../../lib/llm";
import {
  calculateInstallmentPlan,
  calculatePercentagePayment,
} from "../../lib/financial";
import {
  AgentState,
  ReasoningAction,
} from "../state";

function extractText(res: { content: unknown }): string {
  const c = res.content;
  return typeof c === "string"
    ? c
    : Array.isArray(c)
      ? (c as { text?: string }[]).map((x) => x.text ?? "").join("")
      : "";
}

function lastMessages(messages: BaseMessage[], n: number): string {
  const slice = messages.slice(-n);
  return slice
    .map((m) => {
      const t = m.getType();
      const role =
        t === "human" ? "USER" : t === "ai" ? "AGENT" : "SYSTEM";
      const content =
        typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join("\n");
}

function parseReasoningJson(raw: string): {
  action: ReasoningAction;
  response: string;
  tool_call: {
    name: string;
    args: Record<string, unknown>;
  } | null;
} {
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      action: "ANSWER",
      response:
        "Got it — I’m here to help you sort this. What works best for you this week?",
      tool_call: null,
    };
  }
  const parsed = JSON.parse(jsonMatch[0]) as {
    action?: string;
    response?: string;
    tool_call?: { name?: string; args?: Record<string, unknown> } | null;
  };

  const allowed: ReasoningAction[] = [
    "ACCEPT",
    "NEGOTIATE",
    "PLAN",
    "FOLLOW_UP",
    "ESCALATE",
    "ANSWER",
  ];
  const action = allowed.includes(parsed.action as ReasoningAction)
    ? (parsed.action as ReasoningAction)
    : "ANSWER";

  let tool_call = null as {
    name: string;
    args: Record<string, unknown>;
  } | null;
  if (parsed.tool_call && typeof parsed.tool_call.name === "string") {
    tool_call = {
      name: parsed.tool_call.name,
      args: parsed.tool_call.args ?? {},
    };
  }

  return {
    action,
    response:
      typeof parsed.response === "string" && parsed.response.trim()
        ? parsed.response.trim()
        : "Let me know what you can manage, and we’ll line it up.",
    tool_call,
  };
}

function buildSummaryUpdate(state: AgentState, lastUser: string): string {
  const parts: string[] = [];
  if (state.conversationSummary) parts.push(state.conversationSummary);
  if (state.negotiationMode)
    parts.push(`Mode: ${state.negotiationMode}`);
  if (state.borrowerProposedAmount !== undefined)
    parts.push(`User proposed $${state.borrowerProposedAmount}`);
  if (state.isAnchorLocked) parts.push("Anchor locked (repeated amount)");
  if (state.lastUserIntent) parts.push(`Signals: ${state.lastUserIntent}`);
  parts.push(`Last: ${lastUser.slice(0, 200)}`);
  const merged = parts.join(" | ");
  return merged.slice(0, 1200);
}

export async function reasoningNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const messages = state.messages as BaseMessage[];
  const lastUserMessage =
    (messages as { content?: string }[])
      .filter((m) => m && typeof m.content === "string")
      .slice(-1)[0]?.content || "";

  const last5 = lastMessages(messages, 5);
  const totalDebt = state.totalDebt;
  const minimumAccept = state.minimumAccept;

  const monthlyFloor = Math.max(50, Math.round(minimumAccept / 60));

  const isInstallmentContext =
    state.negotiationMode === "INSTALLMENT" ||
    state.borrowerIntent === "INSTALLMENT" ||
    /\b(monthly|\/\s*month|per\s*month)\b/i.test(lastUserMessage);

  const installment =
    state.borrowerProposedAmount !== undefined && isInstallmentContext
      ? calculateInstallmentPlan(totalDebt, state.borrowerProposedAmount, {
          minimumMonthlyFloor: monthlyFloor,
        })
      : null;

  const percentFromMessage = lastUserMessage.match(/(\d+(?:\.\d+)?)\s*%/);
  const samplePercentAmount =
    percentFromMessage && state.borrowerProposedAmount === undefined
      ? calculatePercentagePayment(
          totalDebt,
          parseFloat(percentFromMessage[1]),
        )
      : null;

  const maxTurns = state.maxIterations ?? 6;
  const atTurnLimit = state.negotiationTurnCount >= maxTurns;

  const humans = messages.filter((m) => m.getType() === "human");
  const lastTwoUser = humans.slice(-2);
  const userRepeatedSelf =
    lastTwoUser.length === 2 &&
    String(lastTwoUser[0]?.content ?? "").trim() ===
      String(lastTwoUser[1]?.content ?? "").trim();

  const SYSTEM_PROMPT = `You are a calm, empathetic, and persistent human agent working for Riverline negotiating via WhatsApp (USD only — never use ₹).
You are improvising on the spot like a real human. You MUST return ONLY valid JSON (no markdown fences).

Your JSON shape (strict):
{
  "action": "ACCEPT" | "NEGOTIATE" | "PLAN" | "FOLLOW_UP" | "ESCALATE" | "ANSWER",
  "response": string,
  "tool_call": null | {
    "name": "propose_payment_plan" | "update_borrower_status",
    "args": object
  }
}

Actions:
- ACCEPT — user commitment is clear and aligns with policy; close or confirm next step.
- NEGOTIATE — need a counter or softer framing.
- PLAN — explain timeline/installments with numbers you already have.
- FOLLOW_UP — user needs time or asked to reconnect.
- ESCALATE — abuse, fraud signals, or stuck endlessly.
- ANSWER — factual reply (balance, math).

Core Human & Negotiation Rules - BE PERSUASIVE & SMART:
1. Speak like a real human texting on WhatsApp. Keep responses to 1-3 short sentences. Be varied and natural—never repeat the same exact phrases (like "Is that the absolute maximum") multiple times.
2. LUMP SUM vs MONTHLY: Figure out if they want a lump sum or monthly.
   - A valid LUMP SUM must be AT LEAST $${Math.round(totalDebt * 0.05)}. If they offer a lower lump sum, politely reject it, EXPLICITLY STATE "we expect at least $${Math.round(totalDebt * 0.05)} for now as a lump sum", and ask if they can meet that or prefer a monthly plan instead.
   - For MONTHLY plans, the "minimumAccept" variable does NOT apply. Never quote the huge total payoff amount if they are talking about monthly affordability.
3. HANDLING MONTHLIES: If they offer a low monthly amount, push back ONCE ("Are you expecting any payments?", "Is that truly the max?"). If they insist or say yes, gracefully ACCEPT it! Say "Got it, we can set up a plan at $X/month." AND IMPORTANTLY: You MUST output the propose_payment_plan tool_call. ALWAYS provide proper details for monthlies: explicitly tell the user how many months it will take to clear the debt at that rate (e.g. "At $2000/month your debt will be cleared in roughly X months").
4. HANDLING REFUSALS & HARDSHIPS: If they say "I don't have money", "I'm broke", or "no", DO NOT escalate immediately. First, politely ask for the reason, see if they are expecting payments soon, or propose setting up a very small monthly plan. ONLY if they are repeatedly hostile or refuse ALL help after probing, THEN escalate by using the ESCALATE action and replying EXACTLY: "No worries, our team will schedule a meeting where we can assess your situation and provide a better payment plan."
5. CONFIRMATION LOOP AVOIDANCE: If a payment plan was already proposed and the user just says "ok" or "yes", just reply with "Have a great day!" and DO NOT repeat the plan details.
6. If "isAnchorLocked" is true (user repeated an amount), acknowledge it. Do NOT prompt them for another number. Propose the plan and call the tool!
7. NEVER ignore user-provided dollar amounts. Use PRECOMPUTED installment math for monthly plans.

Tools:
- propose_payment_plan: use IMMEDIATELY when the user explicitly agrees to a concrete amount and a plan isn't already set. Args: { "amount": number, "reason": string, "plan_type"?: "INSTALLMENT" | "LUMP_SUM" }
- update_borrower_status: e.g. NEGOTIATING, PROMISE_TO_PAY. Args: { "status": string, "reasonText": string }`;

  const payload = {
    structured: {
      borrowerName: state.borrowerName,
      totalDebt,
      minimumAccept,
      currency: state.currency,
      negotiationMode: state.negotiationMode,
      borrowerProposedAmount: state.borrowerProposedAmount,
      borrowerIntent: state.borrowerIntent,
      isFinancialQuery: state.isFinancialQuery,
      isAnchorLocked: state.isAnchorLocked,
      borrowerAnchorCount: state.borrowerAnchorCount,
      negotiationTurnCount: state.negotiationTurnCount,
      maxNegotiationTurns: maxTurns,
      atTurnLimit,
      userRepeatedSelf,
      lastUserIntent: state.lastUserIntent,
      conversationSummary: state.conversationSummary,
      negotiationHistory: state.negotiationHistory,
      precomputedInstallment: installment,
      percentOfDebtFromMessage: samplePercentAmount,
    },
    lastFiveMessages: last5,
    lastUserMessage,
  };

  const res = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(JSON.stringify(payload, null, 2)),
  ]);

  const raw = extractText(res);
  let parsed = parseReasoningJson(raw);

  // Trust the LLM to handle repetition and locked anchors naturally via prompt above.

  const conversationSummary = buildSummaryUpdate(state, lastUserMessage);

  const questionLike =
    /\?\s*$/.test(parsed.response) ||
    /^(can you|could you|what|how|when)\b/i.test(parsed.response);
  const lastAgentQuestion = questionLike ? parsed.response : state.lastAgentQuestion;

  return {
    strategy: parsed.action,
    reasoningAction: parsed.action,
    response: parsed.response,
    toolResults: parsed.tool_call ? [parsed.tool_call] : [],
    conversationSummary,
    lastAgentQuestion,
  };
}
