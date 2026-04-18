# Lakeline - AI Debt Collection Agent

An event-driven, production-grade AI agent system for handling debt collection conversations. Built with Node.js, TypeScript, Prisma, BullMQ, and LLM-powered decision making.

## Overview

Lakeline is an intelligent agent that manages debt collection conversations through a sophisticated pipeline:

1. **Receives messages** via BullMQ queue
2. **Classifies intent** using LLM (pay full, partial, refuse, delay)
3. **Selects strategy** via FSM (accept, negotiate, escalate, follow-up)
4. **Generates responses** with negotiation offers
5. **Executes tools** (payment plans, status updates)
6. **Persists state** and schedules follow-ups

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌─────────────┐
│   Queue    │────▶│  Worker  │────▶│   Agent     │
│  (BullMQ)  │     │  (Node)  │     │  Pipeline   │
└─────────────┘     └──────────┘     └─────────────┘
       │                                      │
       ▼                                      ▼
┌─────────────┐                      ┌─────────────┐
│   Redis     │                      │  PostgreSQL │
│  (Queue)    │                      │   (Prisma)  │
└─────────────┘                      └─────────────┘
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `src/lib/queue.ts` | BullMQ queue setup, job configuration, follow-up scheduling |
| `src/lib/worker.ts` | Worker processing with lock contention handling |
| `src/agent/graph.ts` | Main agent pipeline (classify → strategy → tool → response) |
| `src/agent/nodes/` | Individual pipeline nodes (classify, strategy, constraint, tool, evaluation, response) |
| `src/lib/prisma.ts` | Prisma client singleton |
| `src/lib/llm-timeout.ts` | Timeout wrapper + error classification |
| `src/lib/circuit-breaker.ts` | LLM failure protection |

### Database Models

- **Borrower** - Customer with debt information
- **ConversationMessage** - Chat history (USER, AGENT, SYSTEM roles)
- **ProcessedMessage** - Idempotency tracking
- **AgentState** - Persisted agent state per borrower

## Features

### Reliability
- **Idempotency** - ProcessedMessage prevents duplicate processing
- **Per-borrower locking** - Redis-based distributed lock prevents race conditions
- **Ownership-safe heartbeat** - Lock renewal validates ownership before extending TTL
- **Retry with backoff** - BullMQ configured with 3 attempts, exponential backoff

### Resilience
- **LLM timeout handling** - 10-15s timeouts prevent worker hangs
- **Error classification** - RetryableError vs FatalError for proper retry logic
- **Circuit breaker** - In-memory breaker prevents cascading LLM failures
- **Stuck message recovery** - Recovers PROCESSING messages > 5 minutes old

### Observability
- **Structured JSON logging** - All events logged with timestamps
- **Execution timing** - Phase1, classify, tool, response, phase3 timing
- **Error logging** - Error type, retryable flag, stack traces

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis

### Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your database and Redis credentials
```

3. **Run migrations:**
```bash
npx prisma migrate dev
```

4. **Start the worker:**
```bash
npm run worker
```

5. **Start the API (optional):**
```bash
npm run dev
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `OPENAI_API_KEY` | OpenAI API key for LLM | Required |
| `WORKER_CONCURRENCY` | Number of concurrent workers | 10 |

## Usage

### Enqueue a Message

```typescript
import { enqueueMessage } from './lib/queue';

const messageId = await enqueueMessage(
  'borrower-123',
  'I want to pay but need a payment plan'
);
```

### Worker Processing Flow

```
1. Acquire Redis lock (per-borrower)
2. Phase 1: DB Transaction
   - Check idempotency (ProcessedMessage)
   - Store USER/SYSTEM message
   - Load borrower, state, conversation
3. Phase 2: Agent Pipeline (NO DB calls)
   - classifyIntentNode (LLM)
   - strategyNode (FSM)
   - constraintNode
   - toolNode
   - evaluationNode
   - responseNode
4. Phase 3: DB Transaction
   - Save AgentState
   - Store AGENT response
   - Mark DONE
5. Schedule follow-up (if needed)
6. Release lock
```

## Error Handling

### Retryable Errors
- LLM timeout (will be retried by BullMQ)
- Tool execution failure (retried)

### Fatal Errors
- Worker timeout (>30s execution)
- Database connection failure
- Invalid borrower ID

## Production Considerations

For production deployment, consider adding:

- **Redis-based circuit breaker** - Current is in-memory, won't work across multiple workers
- **Dead letter queue** - For poison messages that always fail
- **Monitoring** - Datadog, New Relic, or similar
- **Distributed locking** - Redlock algorithm for multi-region
- **Cron job** - Run `recoverStuckMessages()` periodically

## API Reference

### Queue Functions

```typescript
// Enqueue a new message
enqueueMessage(borrowerId: string, content: string): Promise<string>

// Schedule a follow-up
scheduleFollowUp(borrowerId: string, scheduledAt: Date): Promise<void>

// Retry failed queue jobs
retryFailedMessages(): Promise<number>

// Retry failed DB messages
retryFailedDBMessages(prisma: PrismaClient): Promise<number>

// Recover stuck PROCESSING messages
recoverStuckMessages(prisma: PrismaClient, stuckThresholdMs?: number): Promise<number>
```

### Error Types

```typescript
// LLM timeout - will be retried
new LLMTimeoutError("Operation timed out")

// Retryable - will be retried by BullMQ
new RetryableError("Operation failed")

// Fatal - marked as FAILED, not retried
new FatalError("Non-retryable error")
```

## License

MIT