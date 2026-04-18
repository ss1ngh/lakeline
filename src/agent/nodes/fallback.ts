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

  const systemPrompt = `You are a professional debt collection agent for Lakeline.
Borrower: ${borrowerName}
Total Debt: $${totalDebt}
Minimum Acceptable: $${minimumAccept}
Current Status: ${currentStatus}

The intent was unclear. Respond helpfully and ask for clarification if needed.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      ...msgs.slice(-3),
    ]);
    return { response: response.content as string };
  } catch {
    return {
      response: "Thank you for your message. A representative will contact you shortly.",
    };
  }
}