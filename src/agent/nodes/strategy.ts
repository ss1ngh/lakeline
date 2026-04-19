import { AgentState } from "../state";

export function strategyNode(state: AgentState): Partial<AgentState> {
  const intent = state.intent;
  const amount = state.borrowerProposedAmount;
  const anchor = state.borrowerAnchorCount;
  const debt = state.totalDebt as number;

  if (amount) {
    const minMonthly = Math.max(200, Math.round(debt / 60));
    const ratio = amount / minMonthly;

    if (anchor >= 2) {
      if (ratio >= 0.7) return { strategy: "ACCEPT_INSTALLMENT" };
      return { strategy: "ESCALATE" };
    }

    if (ratio >= 0.75) return { strategy: "ACCEPT_INSTALLMENT" };
    if (ratio < 0.3) return { strategy: "ESCALATE" };

    return { strategy: "NEGOTIATE_INSTALLMENT" };
  }

  if (intent === "PAY_FULL") return { strategy: "ACCEPT_FULL" };
  if (intent === "DELAY") return { strategy: "FOLLOW_UP" };
  if (intent === "REFUSE") return { strategy: "EMPATHIZE" };

  return { strategy: "EMPATHIZE" };
}
