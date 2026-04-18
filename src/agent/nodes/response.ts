import { SystemMessage, BaseMessage } from "@langchain/core/messages";
import { AgentState } from "../state";
import { llm } from "../../lib/llm";

export async function responseNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const {
    borrowerName,
    totalDebt,
    minimumAccept,
    currentStatus,
    strategy,
    constraintResult,
    negotiationHistory,
    messages,
  } = state;

  const msgs = messages as BaseMessage[];
  const history = negotiationHistory || { offers: [] };
  const constraint = constraintResult as Record<string, unknown>;
  const currentOffer = constraint?.amount;

  let responseMessage = "";

  const systemPrompt = `You are a professional debt collection agent for Lakeline.
Borrower: ${borrowerName}
Total Debt: $${totalDebt}
Minimum Acceptable: $${minimumAccept}
Current Status: ${currentStatus}
Strategy: ${strategy}
Proposed Offer: $${currentOffer || "N/A"}
Previous Offers: [${history.offers.join(", ")}]

Generate a response that:
- Acknowledges the negotiation progress
- Uses the actual proposed amount ($${currentOffer})
- Does NOT hallucinate values
- Is concise and professional`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      ...msgs.slice(-5),
    ]);
    responseMessage = response.content as string;
  } catch {
    if (strategy === "ACCEPT_FULL") {
      responseMessage = `Wonderful! We can settle this for the full amount of $${totalDebt}. Let me process this for you.`;
    } else if (strategy === "NEGOTIATE_COUNTER") {
      responseMessage = `I appreciate your consideration. I can offer $${currentOffer} as a counter proposal.`;
    } else if (strategy === "NEGOTIATE_INITIAL") {
      responseMessage = `I can offer a payment plan of $${currentOffer} (70% of the total). Would you like to proceed?`;
    } else {
      responseMessage = "Thank you for your message. We will process your request.";
    }
  }

  return { response: responseMessage };
}