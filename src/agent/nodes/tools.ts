import { AgentState } from "../state";
import { proposePaymentPlan, updateBorrowerStatus } from "../tools";

export async function toolNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const { strategy, constraintResult, negotiationHistory } = state;

  const constraint = constraintResult as Record<string, unknown>;
  const amount = constraint?.amount as number;
  const history = negotiationHistory || { offers: [], lastOffer: undefined };

  const toolResults: unknown[] = [];
  let lastToolSuccess = true;
  let lastAction: AgentState["lastAction"] = null;

  if (strategy === "ACCEPT_FULL") {
    const result = await proposePaymentPlan.invoke({
      amount: amount || 0,
      reason: "Borrower agreed to pay full amount",
    });
    toolResults.push(result);

    const valid = (result as Record<string, unknown>)?.valid === true;
    lastToolSuccess = valid;

    return {
      toolResults,
      lastToolSuccess,
      lastAction: "RESOLVED",
      negotiationHistory: {
        ...history,
        offers: amount ? [...history.offers, amount] : history.offers,
        lastOffer: amount,
      },
    };
  }

  if (strategy === "NEGOTIATE_INITIAL" || strategy === "NEGOTIATE_COUNTER") {
    if (!amount) {
      return {
        toolResults: [{ valid: false, error: "No amount in constraint" }],
        lastToolSuccess: false,
        lastAction: "WAITING_RESPONSE",
      };
    }

    const result = await proposePaymentPlan.invoke({
      amount,
      reason: "Settlement offer extended to borrower",
    });
    toolResults.push(result);

    const valid = (result as Record<string, unknown>)?.valid === true;
    lastToolSuccess = valid;

    if (valid) {
      lastAction = "OFFER_SENT";
    }

    return {
      toolResults,
      lastToolSuccess,
      lastAction,
      negotiationHistory: {
        ...history,
        offers: [...history.offers, amount],
        lastOffer: amount,
      },
    };
  }

  if (strategy === "ESCALATE") {
    const result = await updateBorrowerStatus.invoke({
      status: "DEFAULT_RISK",
      reasonText: "Escalating to collections team",
    });
    toolResults.push(result);
    lastToolSuccess = true;

    return { toolResults, lastToolSuccess, lastAction: "RESOLVED" };
  }

  if (strategy === "FOLLOW_UP") {
    const nextActionAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await updateBorrowerStatus.invoke({
      status: "PENDING",
      reasonText: "Scheduled follow-up",
    });
    toolResults.push(result);
    lastToolSuccess = true;

    return {
      toolResults,
      lastToolSuccess,
      lastAction: "WAITING_RESPONSE",
      nextActionAt,
    };
  }

  return { toolResults, lastToolSuccess, lastAction: "WAITING_RESPONSE" };
}