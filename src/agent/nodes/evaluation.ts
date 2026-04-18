import { AgentState } from "../state";

export function evaluationNode(state: AgentState): Partial<AgentState> {
  const { strategy, negotiationHistory, iterationCount } = state;

  const history = negotiationHistory || { accepted: false, rejected: false };
  const currentIteration = (iterationCount as number) || 0;

  let isResolved = false;
  let lastAction: AgentState["lastAction"] = "WAITING_RESPONSE";

  if (strategy === "ACCEPT_FULL") {
    isResolved = true;
    lastAction = "RESOLVED";
  } else if (strategy === "ESCALATE") {
    isResolved = true;
    lastAction = "RESOLVED";
  } else if (strategy === "FOLLOW_UP") {
    isResolved = false;
    lastAction = "WAITING_RESPONSE";
  } else if (history.accepted === true) {
    isResolved = true;
    lastAction = "RESOLVED";
  }

  return {
    iterationCount: currentIteration + 1,
    isResolved,
    lastAction,
  };
}