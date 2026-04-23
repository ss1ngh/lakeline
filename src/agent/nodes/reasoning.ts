import { SystemMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { llm } from "../../lib/llm";
import {
  calculateInstallmentPlan,
  calculatePercentagePayment,
} from "../../lib/financial";
import {
  AgentState,
  ReasoningAction,
} from "../state";

const ReasoningOutputSchema = z.object({
  borrower_sentiment: z.string()
    .transform(s => s.toUpperCase() as "HOSTILE" | "COOPERATIVE" | "SCARED" | "CONFUSED" | "NEUTRAL")
    .optional().default("NEUTRAL"),
  tone_adopted: z.string()
    .transform(s => s.toUpperCase() as "FIRM" | "EMPATHETIC" | "EXPLANATORY" | "NEUTRAL")
    .optional().default("NEUTRAL"),
  action: z.string()
    .transform(s => s.toUpperCase() as "ACCEPT" | "NEGOTIATE" | "PLAN" | "FOLLOW_UP" | "ESCALATE" | "ANSWER")
    .optional().default("ANSWER"),
  response: z.string().default("Got it. Let's figure out what works best for you."),
  tool_call: z.object({
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }).nullable().optional()
});



function extractText(res: { content: unknown }): string {
  const c = res.content;
  return typeof c === "string"
    ? c
    : Array.isArray(c)
      ? (c as { text?: string }[]).map((x) => x.text ?? "").join("")
      : "";
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

  const SYSTEM_PROMPT = `You are an empathetic yet persistent human agent working for Riverline negotiating via WhatsApp (USD only — never use ₹).
You are improvising on the spot like a real human. You MUST return ONLY valid JSON (no markdown fences).

Your JSON shape MUST match this schema:
{
  "borrower_sentiment": "HOSTILE" | "COOPERATIVE" | "SCARED" | "CONFUSED" | "NEUTRAL",
  "tone_adopted": "FIRM" | "EMPATHETIC" | "EXPLANATORY" | "NEUTRAL",
  "action": "ACCEPT" | "NEGOTIATE" | "PLAN" | "FOLLOW_UP" | "ESCALATE" | "ANSWER",
  "response": "string",
  "tool_call": null or { "name": "propose_payment_plan" | "update_borrower_status", "args": {} }
}

Adaptive Tone Rules:
- If borrower_sentiment is HOSTILE: Be FIRM. Maintain boundaries, be direct, do not over-apologize, and do not offer immediate concessions.
- If borrower_sentiment is SCARED: Be EMPATHETIC. Reassure them, emphasize that you are here to collaborate and find a manageable plan for them.
- If borrower_sentiment is CONFUSED: Be EXPLANATORY. Break down the numbers simply and provide clear, easy next steps.
- If borrower_sentiment is COOPERATIVE: Be APPRECIATIVE and NEUTRAL. Finalize the plan smoothly without friction.

Actions:
- ACCEPT — user commitment is clear and aligns with policy; close or confirm next step.
- NEGOTIATE — need a counter or softer framing.
- PLAN — explain timeline/installments with numbers you already have.
- FOLLOW_UP — user needs time or asked to reconnect.
- ESCALATE — abuse, fraud signals, or stuck endlessly.
- ANSWER — factual reply (balance, math).

Core Human & Negotiation Rules - BE PERSUASIVE & SMART:
1. Speak like a real human texting on WhatsApp. Keep responses to 1-3 short sentences. Be varied and natural.
2. LUMP SUM vs MONTHLY: Figure out if they want a lump sum or monthly.
   - A valid LUMP SUM must be AT LEAST $${Math.round(totalDebt * 0.05)}. If they offer lower, EXPLICITLY STATE "we expect at least $${Math.round(totalDebt * 0.05)} for now".
   - For MONTHLY plans, the "minimumAccept" variable does NOT apply. 
3. HANDLING MONTHLIES: If they offer a low monthly amount, push back ONCE ("Can you stretch it more a little bit?"). If they insist, gracefully ACCEPT it and ALWAYS explicitly tell the user how many months it will take to clear the debt at that rate (e.g., "At $2000/month your debt will be cleared in roughly X months"). You MUST output the propose_payment_plan tool_call.
4. HANDLING REFUSALS & HARDSHIPS: If they say "I don't have money", politely probe for the reason. ONLY if they are repeatedly hostile or refuse ALL help, use the ESCALATE action.
5. CONFIRMATION LOOP AVOIDANCE: If a plan was already agreed and the user says "ok" or "yes", reply with "Ok I'll share the payment link shortly. Have a great day!" and DO NOT repeat details.
6. If "isAnchorLocked" is true, acknowledge it. Do NOT prompt them for another number. Propose the plan and call the tool!
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
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  
  let parsed;
  if (!jsonMatch) {
    console.error("[ReasoningNode] No JSON block found in output:", raw);
    parsed = {
      action: "ANSWER" as const,
      response: "Got it — I’m here to help you sort this. What works best for you this week?",
      tool_call: null,
      borrower_sentiment: "NEUTRAL" as const,
    };
  } else {
    try {
      const rawJson = JSON.parse(jsonMatch[0]);
      parsed = ReasoningOutputSchema.parse(rawJson);
    } catch (e: any) {
      console.error("[ReasoningNode] Parse Error on block:", jsonMatch[0]);
      if (e?.errors) {
        console.error("[ReasoningNode] Zod Validation Errors:", JSON.stringify(e.errors, null, 2));
      } else {
        console.error("[ReasoningNode] JSON Syntax Error:", e.message);
      }
      parsed = {
        action: "ANSWER" as const,
        response: "I see what you mean. Give me a moment to review your file.",
        tool_call: null,
        borrower_sentiment: "NEUTRAL" as const,
      };
    }
  }

  // Trust the LLM to handle repetition and locked anchors naturally via prompt above.

  const conversationSummary = buildSummaryUpdate(state, lastUserMessage);

  const questionLike =
    /\?\s*$/.test(parsed.response) ||
    /^(can you|could you|what|how|when)\b/i.test(parsed.response);
  const lastAgentQuestion = questionLike ? parsed.response : state.lastAgentQuestion;

  return {
    strategy: parsed.action as ReasoningAction,
    reasoningAction: parsed.action as ReasoningAction,
    response: parsed.response,
    toolResults: parsed.tool_call ? [parsed.tool_call] : [],
    conversationSummary,
    lastAgentQuestion,
    sentiment: parsed.borrower_sentiment,
  };
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
