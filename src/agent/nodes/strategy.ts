import { AgentState } from "../state";

export type Strategy =
  | "ACCEPT_FULL"
  | "NEGOTIATE_INITIAL"
  | "NEGOTIATE_COUNTER"
  | "ESCALATE"
  | "FOLLOW_UP"
  | "LLM_FALLBACK";

export function strategyNode(state: AgentState): Partial<AgentState> {
  const intent = state.intent || "UNKNOWN";
  const negotiationHistory = state.negotiationHistory || { 
    offers: [], 
    lastOffer: undefined,
    rejected: false 
  };
  const totalDebt = (state.totalDebt as number) || 0;

  const offers = negotiationHistory.offers || [];
  const lastOffer = negotiationHistory.lastOffer;
  const hasRejection = negotiationHistory.rejected === true;
  
  const rejectionCount = (negotiationHistory as Record<string, unknown>)?.rejectionCount as number || 0;

  const tooManyRejections = rejectionCount >= 2;
  const nearFullAmount = lastOffer ? lastOffer >= 0.9 * totalDebt : false;

  let strategy: Strategy;

  if (intent === "PAY_FULL") {
    strategy = "ACCEPT_FULL";
  } else if (intent === "REFUSE" || tooManyRejections) {
    strategy = "ESCALATE";
  } else if (intent === "DELAY") {
    strategy = "FOLLOW_UP";
  } else if (intent === "PAY_PARTIAL") {
    if (nearFullAmount) {
      strategy = "ESCALATE";
    } else if (offers.length === 0) {
      strategy = "NEGOTIATE_INITIAL";
    } else if (hasRejection) {
      strategy = "NEGOTIATE_COUNTER";
    } else {
      strategy = "NEGOTIATE_INITIAL";
    }
  } else {
    strategy = "LLM_FALLBACK";
  }

  return {
    strategy,
  };
}