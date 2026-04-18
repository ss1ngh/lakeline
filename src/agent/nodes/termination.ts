import { SystemMessage, BaseMessage } from "@langchain/core/messages";
import { AgentState } from "../state";
import { llm } from "../../lib/llm";

export async function terminationNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const {
    borrowerName,
    totalDebt,
    minimumAccept,
    currentStatus,
    iterationCount,
    maxIterations,
    toolResults,
  } = state;

  const iterations = (iterationCount as number);
  const max = (maxIterations as number);
  const msgs = state.messages as BaseMessage[];

  let terminationReason = "";
  let responseMessage = "";

  if (iterations >= max) {
    terminationReason = "MAX_ITERATIONS_REACHED";
    responseMessage = `I've reached the maximum number of attempts (${max}). Let me connect you with a specialist who can better assist you.`;
  } else {
    terminationReason = "RESOLVED";
  }

  const systemPrompt = `You are a professional debt collection agent for Lakeline.
Borrower: ${borrowerName}
Total Debt: $${totalDebt}
Minimum Acceptable: $${minimumAccept}
Current Status: ${currentStatus}
Iterations: ${iterations}/${max}
Termination Reason: ${terminationReason}
Tool Results: ${JSON.stringify(toolResults)}

Generate a final response explaining the outcome.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      ...msgs.slice(-5),
    ]);
    responseMessage = response.content as string;
  } catch {
    if (terminationReason === "MAX_ITERATIONS_REACHED") {
      responseMessage = `I've made ${iterations} attempts to resolve this but haven't been able to reach an agreement. A specialist will contact you shortly to continue this discussion.`;
    } else {
      responseMessage = "Thank you for your time. We look forward to resolving this matter.";
    }
  }

  return {
    response: responseMessage,
  };
}