import { SystemMessage, BaseMessage } from "@langchain/core/messages";
import { AgentState } from "../state";
import { llm } from "../../lib/llm";

export async function terminationNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const { borrowerName, totalDebt, strategy, messages } = state;

  const msgs = messages as BaseMessage[];

  const systemPrompt = `You are Priya, a debt counsellor texting ${borrowerName} on WhatsApp. You are a real human.

The conversation needs to wrap up. Depending on the reason:
- If negotiation broke down: Tell them warmly but firmly that you've tried your best, you'll have a colleague follow up with them, and leave the door open.
- If they escalated: Let them know the account is being handed to a specialist who will be in touch soon.
- Never say things like "maximum interactions reached", "system limit", "I cannot continue this conversation", or anything that reveals you're an automated system.
- Never say "Thank you. We'll be in touch." — it's cold and robotic.
- Sound like a real person wrapping up a WhatsApp conversation. 2–3 sentences max.

Outstanding balance for context (don't mention unless natural): $${totalDebt.toLocaleString()}`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      ...msgs.slice(-4),
    ]);
    const text = Array.isArray(response.content)
      ? (response.content as any[]).map((c: any) => c.text ?? "").join("")
      : (response.content as string);
    return { response: text };
  } catch {
    // Fallback — still sounds human
    return {
      response: `${borrowerName}, I appreciate you speaking with me today. I'll have one of my colleagues reach out to you shortly to help find the best way forward. Take care.`,
    };
  }
}
