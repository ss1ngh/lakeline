import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const proposePaymentPlanSchema = z.object({
  amount: z.number().describe("The proposed payment amount"),
  reason: z.string().describe("Reason for the offer"),
});

export const updateBorrowerStatusSchema = z.object({
  status: z
    .enum(["PENDING", "CONTACTED", "NEGOTIATING", "PROMISE_TO_PAY", "DEFAULT_RISK"])
    .describe("The new status to set"),
  reasonText: z.string().describe("Reason for status change"),
});

export const proposePaymentPlan = tool(
  async (input) => {
    const { amount, reason } = input;
    const valid = amount > 0;
    return {
      valid,
      amount,
      plan: valid
        ? `Payment plan: Pay $${amount} to settle the debt. ${reason}`
        : "Invalid amount. Please propose a valid amount.",
    };
  },
  {
    name: "propose_payment_plan",
    description: "Propose a payment plan to the borrower. Use this when the borrower shows willingness to pay.",
    schema: proposePaymentPlanSchema,
  }
);

export const updateBorrowerStatus = tool(
  async (input) => {
    const { status, reasonText } = input;
    return {
      success: true,
      status,
      message: `Status updated to ${status}. Reason: ${reasonText}`,
    };
  },
  {
    name: "update_borrower_status",
    description: "Update the borrower's status in the FSM.",
    schema: updateBorrowerStatusSchema,
  }
);

export const tools = [proposePaymentPlan, updateBorrowerStatus];