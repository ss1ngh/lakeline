import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState } from "../state";

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.2,
});

const SYSTEM_PROMPT = `You are a debt collection agent. Analyze the borrower's message and classify:
- Intent: PAY_FULL (agree to pay), PAY_PARTIAL (wants to pay less), REFUSE (won't pay), DELAY (needs time), or UNKNOWN
- Sentiment: POSITIVE, NEGATIVE, or NEUTRAL

Respond with JSON only: {"intent": "...", "sentiment": "..."}`;

export async function classifyIntentNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const messages = state.messages as any[];
  const recentMessages = messages
    .slice(-5)
    .map((m: any) => `${m.role}: ${m.content}`)
    .join("\n");

  const history = state.negotiationHistory || { 
    offers: [], 
    rejected: false, 
    accepted: false 
  };

  const rejectionCount = (history as Record<string, unknown>)?.rejectionCount as number || 0;

  try {
    const response = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Recent messages:\n${recentMessages}`),
    ]);

    const parsed = JSON.parse(response.content as string);
    const intent = parsed.intent || "UNKNOWN";
    const sentiment = parsed.sentiment || "NEUTRAL";

    let updatedHistory = {
      ...history,
      rejectionCount,
    };

    if (intent === "REFUSE" || intent === "PAY_PARTIAL") {
      updatedHistory = {
        ...history,
        rejected: true,
        rejectionCount: rejectionCount + 1,
      };
    } else if (intent === "PAY_FULL") {
      updatedHistory = {
        ...history,
        accepted: true,
        rejected: false,
        rejectionCount,
      };
    }

    return {
      intent,
      sentiment,
      negotiationHistory: updatedHistory as AgentState["negotiationHistory"],
    };
  } catch {
    return {
      intent: "UNKNOWN",
      sentiment: "NEUTRAL",
      negotiationHistory: history as AgentState["negotiationHistory"],
    };
  }
}