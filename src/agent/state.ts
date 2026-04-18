import { BaseMessage } from "@langchain/core/messages";

export interface AgentStateInput {
  messages: BaseMessage[];
  borrowerId: string;
  borrowerName: string;
  totalDebt: number;
  minimumAccept: number;
  currentStatus: string;
  persistedState?: AgentState;
  messageId?: string;
  [key: string]: unknown;
}

export interface AgentState extends AgentStateInput {
  intent: string;
  sentiment: string;
  strategy: string;
  constraintResult: Record<string, unknown>;
  toolResults: unknown[];
  response: string;
  iterationCount: number;
  maxIterations: number;
  isResolved: boolean;
  lastToolSuccess: boolean;
  negotiationHistory: {
    offers: number[];
    lastOffer?: number;
    accepted?: boolean;
    rejected?: boolean;
    rejectionCount: number;
  };
  retryCount: {
    classify: number;
    tool: number;
  };
  nextActionAt?: Date;
  lastAction: "OFFER_SENT" | "WAITING_RESPONSE" | "RESOLVED" | null;
}

export function createInitialState(input: AgentStateInput): AgentState {
  return {
    ...input,
    intent: "UNKNOWN",
    sentiment: "NEUTRAL",
    strategy: "",
    constraintResult: {},
    toolResults: [],
    response: "",
    iterationCount: 0,
    maxIterations: 3,
    isResolved: false,
    lastToolSuccess: true,
    negotiationHistory: {
      offers: [],
      lastOffer: undefined,
      accepted: undefined,
      rejected: false,
      rejectionCount: 0,
    },
    retryCount: {
      classify: 0,
      tool: 0,
    },
    nextActionAt: undefined,
    lastAction: null,
  };
}

export interface PersistableState {
  borrowerId: string;
  intent: string;
  sentiment: string;
  strategy: string;
  iterationCount: number;
  status: string;
  negotiationHistory: {
    offers: number[];
    lastOffer?: number;
    accepted?: boolean;
    rejected?: boolean;
    rejectionCount: number;
  };
  lastAction: "OFFER_SENT" | "WAITING_RESPONSE" | "RESOLVED" | null;
  nextActionAt?: Date;
  updatedAt: Date;
}