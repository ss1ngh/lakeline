import { BaseMessage } from "@langchain/core/messages";

export type NegotiationMode = "INSTALLMENT" | "LUMP_SUM";
export type BorrowerParsedIntent = "INSTALLMENT" | "LUMP_SUM" | "UNKNOWN";

export type ReasoningAction =
  | "ACCEPT"
  | "NEGOTIATE"
  | "PLAN"
  | "FOLLOW_UP"
  | "ESCALATE"
  | "ANSWER";

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

  borrowerProposedAmount?: number;
  totalConceded: number;
  softFloor: number;

  decisionProposedAmount?: number;
  decisionShouldEscalate?: boolean;
  decisionShouldFollowUp?: boolean;

  /** Structured classify output */
  borrowerIntent: BorrowerParsedIntent;
  isFinancialQuery: boolean;

  negotiationMode: NegotiationMode | null;
  borrowerAnchorCount: number;
  lastBorrowerAmount?: number;
  isAnchorLocked: boolean;
  currency: "USD";
  conversationSummary: string;
  lastUserIntent: string;

  /** Mid-term loop / repetition control */
  negotiationTurnCount: number;
  lastAgentQuestion?: string;

  /** Latest reasoning decision (mirrors strategy for graph compatibility) */
  reasoningAction?: ReasoningAction;
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
    maxIterations: 6,
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

    borrowerProposedAmount: undefined,
    totalConceded: 0,
    softFloor: 0,

    decisionProposedAmount: undefined,
    decisionShouldEscalate: false,
    decisionShouldFollowUp: false,

    borrowerIntent: "UNKNOWN",
    isFinancialQuery: false,

    negotiationMode: null,
    borrowerAnchorCount: 0,
    lastBorrowerAmount: undefined,
    isAnchorLocked: false,
    currency: "USD",
    conversationSummary: "",
    lastUserIntent: "",

    negotiationTurnCount: 0,
    lastAgentQuestion: undefined,
    reasoningAction: undefined,
  };
}
