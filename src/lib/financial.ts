/**
 * Pure financial helpers for debt negotiation (USD).
 */

export interface InstallmentPlanResult {
  monthsNeeded: number;
  totalPaid: number;
  /** True when the payoff horizon is within a reasonable window. */
  feasible: boolean;
}

const DEFAULT_MAX_MONTHS = 60;

/**
 * @param totalDebt — principal owed (USD)
 * @param monthlyAmount — proposed recurring payment (USD / month)
 */
export function calculateInstallmentPlan(
  totalDebt: number,
  monthlyAmount: number,
  options?: { maxMonths?: number; minimumMonthlyFloor?: number },
): InstallmentPlanResult {
  if (!Number.isFinite(totalDebt) || totalDebt <= 0) {
    return { monthsNeeded: 0, totalPaid: 0, feasible: false };
  }
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
    return { monthsNeeded: 0, totalPaid: 0, feasible: false };
  }

  const maxMonths = options?.maxMonths ?? DEFAULT_MAX_MONTHS;
  const monthsNeeded = Math.ceil(totalDebt / monthlyAmount);
  const totalPaid = monthsNeeded * monthlyAmount;

  const meetsFloor =
    options?.minimumMonthlyFloor === undefined
      ? true
      : monthlyAmount >= options.minimumMonthlyFloor;

  const feasible = monthsNeeded <= maxMonths && meetsFloor;

  return { monthsNeeded, totalPaid, feasible };
}

export function calculatePercentagePayment(
  totalDebt: number,
  percent: number,
): number {
  if (!Number.isFinite(totalDebt) || totalDebt <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const clamped = Math.min(100, percent);
  return Math.round((clamped / 100) * totalDebt);
}

/** Block agent-side counter-offers that jump unrealistically from the last anchor. */
export function isAbsurdJump(
  previousAmount: number | undefined,
  nextAmount: number,
  maxRatio = 4,
): boolean {
  if (previousAmount === undefined || previousAmount <= 0) return false;
  if (nextAmount <= previousAmount) return false;
  return nextAmount / previousAmount > maxRatio;
}

export function clampAmount(
  amount: number,
  floor: number,
  ceiling: number,
): number {
  return Math.min(ceiling, Math.max(floor, Math.round(amount)));
}
