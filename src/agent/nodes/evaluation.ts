import { AgentState } from "../state";

export function evaluationNode(state: AgentState): Partial<AgentState> {
  if (state.lastAction === "RESOLVED") {
    return {
      isResolved: true,
      lastAction: "RESOLVED",
    };
  }

  return {
    isResolved: false,
    lastAction: "WAITING_RESPONSE",
  };
}
