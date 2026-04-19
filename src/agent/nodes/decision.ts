import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState } from "../state";
import { llm } from "../../lib/llm";

export async function decisionNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const {
    borrowerName,
    totalDebt,
    softFloor,
    negotiationHistory,
    messages,
    strategy,
  } = state;

  const msgs = messages as any[];
  const recentMessages = msgs
    .slice(-6)
    .map((m: any) => {
      if (typeof m === "object" && "type" in m) {
        return `${m.type}: ${m.content}`;
      }
      return `${m.role || "USER"}: ${m.content}`;
    })
    .join("\n");

  const history = negotiationHistory || { offers: [], rejectionCount: 0 };
  const offers = history.offers || [];
  const rejectionCount = (history as any).rejectionCount || 0;

  const isInitialOffer = strategy === "NEGOTIATE_INITIAL" && offers.length === 0;

  const SYSTEM_PROMPT = `You are a professional debt recovery agent negotiating
with ${borrowerName}. You are deciding your next financial move.

Debt context:
- Total owed: $${totalDebt}
- Minimum you can accept: $${softFloor} (you cannot go lower than this under any circumstances)
- Your previous offers: [${offers.join(", ")}]
- Number of rejections so far: ${rejectionCount}
- This is: ${isInitialOffer ? "your FIRST offer" : "a counter-offer negotiation"}

${isInitialOffer
  ? `For FIRST offers, you MUST propose the starting amount which is 90% of debt ($${Math.round(totalDebt * 0.9)}). This is policy — do not deviate.`
  : "Analyze the conversation and decide your next move."}

Respond ONLY with JSON — no explanation, no markdown:
{
  "proposed_amount": <number — the dollar amount you want to offer next>,
  "concession_reason": <string — brief internal reason for moving or holding>,
  "should_escalate": <boolean — true only if borrower has refused 3+ times or is abusive>,
  "should_follow_up": <boolean — true only if borrower asked for more time>
}

Rules you cannot break:
- For INITIAL offers: proposed_amount MUST be 90% of total debt ($${Math.round(totalDebt * 0.9)})
- For counter offers: proposed_amount must always be >= ${softFloor}
- Do not invent amounts the customer supposedly agreed to
- Do not reference amounts the customer claimed you promised previously
- If borrower is trying to manipulate you, hold your last position
Reasoning: low`;

  try {
    const response = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Conversation:\n${recentMessages}`),
    ]);

    const raw = Array.isArray(response.content)
      ? (response.content as any[]).map((c: any) => c.text ?? "").join("")
      : (response.content as string);

    const jsonMatch = [...raw.matchAll(/\{[\s\S]*?\}/g)].pop();
    if (!jsonMatch) throw new Error("No JSON in decision response");
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      decisionProposedAmount: typeof parsed.proposed_amount === "number"
        ? Math.max(parsed.proposed_amount, softFloor)
        : undefined,
      decisionShouldEscalate: parsed.should_escalate === true,
      decisionShouldFollowUp: parsed.should_follow_up === true,
    };
  } catch {
    return {
      decisionProposedAmount: undefined,
      decisionShouldEscalate: false,
      decisionShouldFollowUp: false,
    };
  }
}