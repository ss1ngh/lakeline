import { AgentState } from "../state";

export function constraintNode(state: AgentState): Partial<AgentState> {
  const { strategy, totalDebt, minimumAccept, negotiationHistory } = state;

  const debt = totalDebt as number;
  const minAccept = minimumAccept as number;
  const history = negotiationHistory || { offers: [], lastOffer: undefined };

  if (strategy === "NEGOTIATE_INITIAL") {
    const initialOffer = Math.round(debt * 0.7);

    if (initialOffer < minAccept) {
      return {
        constraintResult: {
          allowed: false,
          reason: `Offer ${initialOffer} below minimumAccept ${minAccept}`,
          minAcceptable: minAccept,
          amount: minAccept,
        },
      };
    }

    return {
      constraintResult: {
        allowed: true,
        amount: initialOffer,
        reason: "70% initial offer meets minimum threshold",
        iteration: "initial",
      },
    };
  }

  if (strategy === "NEGOTIATE_COUNTER") {
    const previousOffer = history.lastOffer || Math.round(debt * 0.7);

    const counterOffer = Math.round(
      Math.min(previousOffer + debt * 0.1, debt)
    );

    if (counterOffer < minAccept) {
      return {
        constraintResult: {
          allowed: false,
          reason: `Counter offer ${counterOffer} below minimumAccept ${minAccept}`,
          minAcceptable: minAccept,
          amount: minAccept,
        },
      };
    }

    return {
      constraintResult: {
        allowed: true,
        amount: counterOffer,
        reason: `Counter offer: ${counterOffer} (increased from ${previousOffer})`,
        iteration: "counter",
        previousOffer,
      },
    };
  }

  if (strategy === "ACCEPT_FULL") {
    return {
      constraintResult: {
        allowed: true,
        amount: debt,
        reason: "Full payment accepted",
      },
    };
  }

  return {
    constraintResult: {
      allowed: true,
      reason: "No financial constraints apply",
    },
  };
}