import { PrismaClient } from "@prisma/client";
import { createInitialState } from "../agent/state";

const prisma = new PrismaClient();

export async function loadState(borrowerId: string) {
  const dbState = await prisma.agentState.findUnique({
    where: { borrowerId },
    include: { borrower: true },
  });

  if (!dbState) {
    const borrower = await prisma.borrower.findUnique({
      where: { id: borrowerId },
    });

    if (!borrower) {
      throw new Error(`Borrower not found: ${borrowerId}`);
    }

    return createInitialState({
      messages: [],
      borrowerId: borrower.id,
      borrowerName: borrower.name,
      totalDebt: borrower.totalDebt,
      minimumAccept: borrower.minimumAccept,
      currentStatus: borrower.status,
    });
  }

  const negotiationData = dbState.negotiationData as Record<string, unknown> || {};
  const retryData = dbState.retryData as Record<string, unknown> || {};

  return {
    messages: [],
    borrowerId: dbState.borrowerId,
    borrowerName: dbState.borrower.name,
    totalDebt: dbState.borrower.totalDebt,
    minimumAccept: dbState.borrower.minimumAccept,
    currentStatus: dbState.borrower.status,

    intent: dbState.intent,
    sentiment: dbState.sentiment,
    strategy: dbState.strategy,
    constraintResult: {},
    toolResults: [],
    response: "",
    iterationCount: dbState.iterationCount,
    maxIterations: 3,
    isResolved: dbState.lastAction === "RESOLVED",
    lastToolSuccess: true,

    negotiationHistory: {
      offers: (negotiationData.offers as number[]) || [],
      lastOffer: negotiationData.lastOffer as number | undefined,
      accepted: negotiationData.accepted as boolean | undefined,
      rejected: negotiationData.rejected as boolean | undefined,
      rejectionCount: (negotiationData.rejectionCount as number) || 0,
    },

    retryCount: {
      classify: (retryData.classify as number) || 0,
      tool: (retryData.tool as number) || 0,
    },

    nextActionAt: dbState.nextActionAt || undefined,
    lastAction: dbState.lastAction as "OFFER_SENT" | "WAITING_RESPONSE" | "RESOLVED" | null,
  };
}

export async function saveState(borrowerId: string, state: any): Promise<void> {
  const negotiationData = {
    offers: state.negotiationHistory?.offers || [],
    lastOffer: state.negotiationHistory?.lastOffer,
    accepted: state.negotiationHistory?.accepted,
    rejected: state.negotiationHistory?.rejected,
    rejectionCount: state.negotiationHistory?.rejectionCount || 0,
  };

  const retryData = {
    classify: state.retryCount?.classify || 0,
    tool: state.retryCount?.tool || 0,
  };

  await prisma.agentState.upsert({
    where: { borrowerId },
    update: {
      intent: state.intent || "UNKNOWN",
      sentiment: state.sentiment || "NEUTRAL",
      strategy: state.strategy || "",
      iterationCount: state.iterationCount || 0,
      lastAction: state.lastAction,
      nextActionAt: state.nextActionAt,
      negotiationData: negotiationData as any,
      retryData: retryData as any,
    },
    create: {
      borrowerId,
      intent: state.intent || "UNKNOWN",
      sentiment: state.sentiment || "NEUTRAL",
      strategy: state.strategy || "",
      iterationCount: state.iterationCount || 0,
      lastAction: state.lastAction,
      nextActionAt: state.nextActionAt,
      negotiationData: negotiationData as any,
      retryData: retryData as any,
    },
  });
}

export { prisma };