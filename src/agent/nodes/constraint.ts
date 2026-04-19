import { AgentState } from "../state";

/**
 * Discount tiers based on total debt:
 * < ₹50k   → up to 10% discount
 * ₹50k–2L  → up to 7% discount
 * ₹2L–5L   → up to 5% discount
 * > ₹5L    → up to 3% discount (large loans, minimal concession)
 *
 * We start at the top of the range and step down each counter-offer.
 */
function maxDiscountPct(debt: number): number {
  if (debt < 50_000) return 0.1;
  if (debt < 200_000) return 0.07;
  if (debt < 500_000) return 0.05;
  return 0.03;
}

function initialOfferAmount(debt: number, minAccept: number): number {
  // Start at max discount (which is already conservative)
  const maxDisc = maxDiscountPct(debt);
  const offer = Math.round(debt * (1 - maxDisc));
  return Math.max(offer, minAccept);
}

function stepSize(debt: number): number {
  // Step down in small increments — don't give it all away at once
  if (debt < 10_000) return 300;
  if (debt < 50_000) return 500;
  if (debt < 200_000) return 1_000;
  if (debt < 500_000) return 2_000;
  return 3_000;
}

export function constraintNode(state: AgentState): Partial<AgentState> {
  const {
    strategy,
    totalDebt,
    minimumAccept,
    negotiationHistory,
    borrowerProposedAmount,
    decisionProposedAmount,
  } = state;

  const debt = totalDebt as number;
  const minAccept = minimumAccept as number;
  const history = negotiationHistory || { offers: [], lastOffer: undefined };

  // Minimum accept = debt * (1 - maxDiscountPct) — enforced hard floor
  const hardFloor = Math.max(
    Math.round(debt * (1 - maxDiscountPct(debt))),
    minAccept,
  );

  const maxAllowedConcession = debt - hardFloor;
  const currentConcession = history.lastOffer ? debt - history.lastOffer : 0;
  const concessionRate =
    maxAllowedConcession > 0 ? currentConcession / maxAllowedConcession : 0;
  const concessionLimitReached = concessionRate >= 0.9;

  if (strategy === "NEGOTIATE_INITIAL") {
    const offer = initialOfferAmount(debt, hardFloor);
    const discountPct = Math.round(((debt - offer) / debt) * 100);

    return {
      constraintResult: {
        allowed: true,
        amount: offer,
        discountPct,
        reason: `Initial offer at ${discountPct}% discount`,
        iteration: "initial",
        hardFloor,
      },
      totalConceded: debt - offer,
      negotiationHistory: {
        ...history,
        offers: [...history.offers, offer],
        lastOffer: offer,
      },
    };
  }

  if (strategy === "NEGOTIATE_COUNTER") {
    const previousOffer =
      history.lastOffer ?? initialOfferAmount(debt, hardFloor);
    const step = stepSize(debt);

    let counterOffer: number;

    if (concessionLimitReached) {
      counterOffer = hardFloor;
    } else if (
      decisionProposedAmount &&
      decisionProposedAmount >= hardFloor &&
      decisionProposedAmount <= previousOffer
    ) {
      counterOffer = decisionProposedAmount;
    } else if (borrowerProposedAmount && borrowerProposedAmount >= hardFloor) {
      // Meet halfway between their ask and our last offer
      counterOffer = Math.round((borrowerProposedAmount + previousOffer) / 2);
    } else if (borrowerProposedAmount && borrowerProposedAmount < hardFloor) {
      // They're asking too low — step down a bit but stay above floor
      counterOffer = Math.max(previousOffer - step, hardFloor);
    } else {
      counterOffer = Math.max(previousOffer - step, hardFloor);
    }

    counterOffer = Math.max(counterOffer, hardFloor);
    const discountPct = Math.round(((debt - counterOffer) / debt) * 100);

    return {
      constraintResult: {
        allowed: true,
        amount: counterOffer,
        discountPct,
        reason: `Counter offer: ${discountPct}% discount from original amount`,
        iteration: "counter",
        previousOffer,
        step,
        hardFloor,
        concessionRate: Math.round(concessionRate * 100),
      },
      totalConceded: debt - counterOffer,
      negotiationHistory: {
        ...history,
        offers: [...history.offers, counterOffer],
        lastOffer: counterOffer,
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
      totalConceded: 0,
    };
  }

  if (strategy === "DEFLECT") {
    const holdAmount = history.lastOffer ?? initialOfferAmount(debt, hardFloor);
    const discountPct = Math.round(((debt - holdAmount) / debt) * 100);
    return {
      constraintResult: {
        allowed: true,
        amount: holdAmount,
        discountPct,
        reason: "Holding position",
        iteration: "deflect",
      },
      totalConceded: debt - holdAmount,
    };
  }

  // For EMPATHIZE, FOLLOW_UP, LLM_FALLBACK — no financial constraint needed yet
  return {
    constraintResult: {
      allowed: true,
      reason: "No financial constraints apply",
    },
  };
}
