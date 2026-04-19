import { AgentState } from "../state";

function fmt(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

export async function responseNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const {
    borrowerName,
    totalDebt,
    borrowerProposedAmount,
    strategy,
    constraintResult,
  } = state;

  // HANDLE % or amount cases already parsed
  if (strategy === "ACCEPT_INSTALLMENT") {
    return {
      response: `That works, ${borrowerName}. We’ll proceed with ${fmt(
        borrowerProposedAmount || 0,
      )} per month. I’ll send you the setup details.`,
    };
  }

  if (strategy === "NEGOTIATE_INSTALLMENT" && borrowerProposedAmount) {
    const settlement = Math.round(totalDebt * 0.93);
    const months = Math.ceil(settlement / borrowerProposedAmount);

    if (months <= 60) {
      return {
        response: `Got it — ${fmt(
          borrowerProposedAmount,
        )}/month works. You’d clear this in about ${months} months. Shall I set this up?`,
      };
    }

    const suggested = Math.round(borrowerProposedAmount * 1.2);

    return {
      response: `I understand — ${fmt(
        borrowerProposedAmount,
      )} helps, but it will take quite long. If you could stretch to around ${fmt(
        suggested,
      )}, we can close this faster. Would that work?`,
    };
  }

  if (strategy === "EMPATHIZE") {
    return {
      response: `I understand — these situations can be tough. What’s a realistic amount you could set aside monthly?`,
    };
  }

  if (strategy === "FOLLOW_UP") {
    return {
      response: `Got it — is this just for this month, or are things tight for a while?`,
    };
  }

  if (strategy === "ESCALATE") {
    return {
      response: `I’ve tried my best to work something out. I’ll have someone from our team reach out to you shortly.`,
    };
  }

  if (strategy === "ACCEPT_FULL") {
    const amt = (constraintResult as any)?.amount || totalDebt;

    return {
      response: `Great, ${borrowerName}. I’ll send you the payment link for ${fmt(
        amt,
      )}. Once completed, your account will be settled.`,
    };
  }

  return {
    response: `Your outstanding balance is ${fmt(
      totalDebt,
    )}. Would you like to pay in full or set up a monthly plan?`,
  };
}
