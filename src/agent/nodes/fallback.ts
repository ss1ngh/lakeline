import { SystemMessage, BaseMessage } from "@langchain/core/messages";
import { AgentState } from "../state";
import { llm } from "../../lib/llm";

export async function fallbackNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const {
    borrowerName,
    totalDebt,
    minimumAccept,
    currentStatus,
    messages,
  } = state;

  const msgs = messages as BaseMessage[];

  const systemPrompt = `You are a debt recovery agent texting ${borrowerName} on WhatsApp.
The customer's intent was unclear. Respond like a real human would — warm, brief,
and curious. Ask one simple clarifying question to understand what they need.
Do not mention debt amounts. Do not sound like a bot. Max 2 sentences.
Total debt context (do not share): $${totalDebt}`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      ...msgs.slice(-3),
    ]);
    const text = Array.isArray(response.content)
      ? (response.content as any[]).map((c: any) => c.text ?? "").join("")
      : (response.content as string);
    return { response: text };
  } catch {
    return {
      response: "Thanks for reaching out — tell me a bit more about what's going on?",
    };
  }
}