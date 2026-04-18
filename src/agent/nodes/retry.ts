import { AgentState } from "../state";
import { classifyIntentNode } from "./classify";
import { toolNode } from "./tools";

export async function retryNode(
  state: AgentState,
  retryType: "classify" | "tool"
): Promise<Partial<AgentState>> {
  const { intent, lastToolSuccess, retryCount, constraintResult } = state;

  const count = retryCount || { classify: 0, tool: 0 };

  if (retryType === "classify") {
    if (intent === "UNKNOWN" && (count.classify as number) < 2) {
      const retryResult = await classifyIntentNode(state);
      return {
        ...retryResult,
        retryCount: {
          ...count,
          classify: (count.classify as number) + 1,
        },
      };
    }
    return {
      intent: state.intent,
      sentiment: state.sentiment,
      retryCount: count,
    };
  }

  if (retryType === "tool") {
    if (!lastToolSuccess && (count.tool as number) < 2 && constraintResult) {
      const toolRetryResult = await toolNode(state);
      return {
        ...toolRetryResult,
        retryCount: {
          ...count,
          tool: (count.tool as number) + 1,
        },
      };
    }
  }

  return {
    retryCount: count,
  };
}