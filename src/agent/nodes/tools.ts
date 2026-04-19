import { prisma } from "../../lib/prisma";
import { calculateInstallmentPlan } from "../../lib/financial";
import { AgentState } from "../state";
import { proposePaymentPlan, updateBorrowerStatusSchema } from "../tools";

const ALLOWED = new Set(["propose_payment_plan", "update_borrower_status"]);

export async function toolNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const raw = state.toolResults?.[0] as
    | {
        name?: string;
        args?: Record<string, unknown>;
      }
    | undefined;

  if (!raw?.name) {
    return {
      lastToolSuccess: true,
      lastAction: "WAITING_RESPONSE",
    };
  }

  if (!ALLOWED.has(raw.name)) {
    return {
      lastToolSuccess: false,
      toolResults: [],
      lastAction: "WAITING_RESPONSE",
    };
  }

  if (raw.name === "propose_payment_plan") {
    const amount = Number(raw.args?.amount);
    const reason =
      typeof raw.args?.reason === "string"
        ? raw.args.reason
        : "Agreed payment plan";
    const planType =
      (raw.args?.plan_type as "INSTALLMENT" | "LUMP_SUM" | undefined) ??
      (state.negotiationMode === "INSTALLMENT" ? "INSTALLMENT" : "LUMP_SUM");

    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        lastToolSuccess: false,
        toolResults: [{ error: "invalid_amount" }],
        lastAction: "WAITING_RESPONSE",
      };
    }

    if (amount > state.totalDebt * 3) {
      return {
        lastToolSuccess: false,
        toolResults: [{ error: "amount_out_of_range" }],
        lastAction: "WAITING_RESPONSE",
      };
    }

    if (planType === "LUMP_SUM" && amount < state.minimumAccept) {
      return {
        lastToolSuccess: false,
        toolResults: [
          {
            valid: false,
            reason: `Lump offer below minimum acceptable ($${state.minimumAccept}).`,
          },
        ],
        lastAction: "WAITING_RESPONSE",
      };
    }

    if (planType === "INSTALLMENT") {
      const { feasible, monthsNeeded } = calculateInstallmentPlan(
        state.totalDebt,
        amount,
        { maxMonths: 120 },
      );
      if (!feasible || monthsNeeded > 120) {
        return {
          lastToolSuccess: false,
          toolResults: [
            {
              valid: false,
              reason: "Installment horizon too long under policy.",
            },
          ],
          lastAction: "WAITING_RESPONSE",
        };
      }
    }

    const result = await proposePaymentPlan.invoke({
      amount,
      reason,
      plan_type: planType,
    });

    const nextOffers = [...state.negotiationHistory.offers, amount];

    return {
      toolResults: [result],
      lastToolSuccess: true,
      lastAction: "RESOLVED",
      negotiationHistory: {
        ...state.negotiationHistory,
        offers: nextOffers,
        lastOffer: amount,
        accepted: true,
      },
      isResolved: true,
    };
  }

  if (raw.name === "update_borrower_status") {
    const parsed = updateBorrowerStatusSchema.safeParse(raw.args ?? {});
    if (!parsed.success) {
      return {
        lastToolSuccess: false,
        toolResults: [{ error: "invalid_status_payload" }],
        lastAction: "WAITING_RESPONSE",
      };
    }

    const { status, reasonText } = parsed.data;

    await prisma.borrower.update({
      where: { id: state.borrowerId },
      data: { status },
    });

    return {
      toolResults: [
        {
          success: true,
          status,
          message: `Status updated to ${status}. Reason: ${reasonText}`,
        },
      ],
      lastToolSuccess: true,
      lastAction: "WAITING_RESPONSE",
      currentStatus: status,
    };
  }

  return {
    lastToolSuccess: true,
    lastAction: "WAITING_RESPONSE",
  };
}
