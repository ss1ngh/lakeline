# Lakeline

AI-powered debt collection agent that manages conversations with borrowers through an intelligent, multi-step agent graph powered by LangGraph.

## Overview

Lakeline is a Next.js application with a dedicated background worker that processes borrower conversations. The system uses a stateful AI agent (built with LangGraph) to:

- Classify incoming messages (intent detection)
- Generate context-aware responses using reasoning
- Execute tools for financial calculations and offers
- Evaluate and determine next actions
- Schedule follow-ups for unresolved conversations

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 16.2.4 |
| Language | TypeScript |
| UI | React 19.2.4 + Tailwind CSS 4 |
| Database | PostgreSQL + Prisma 7 |
| Queue/Worker | BullMQ + Redis |
| AI Agent | LangGraph + LangChain |
| LLM Providers | Groq (default) or OpenAI |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js API                               │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │  Conversations   │    │     Agent Execution API           │  │
│  │    Dashboard    │    │  (POST /api/conversations/:id/send)│  │
│  └──────────────────┘    └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Redis Queue (BullMQ)                       │
│                         agent-queue                              │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Background Worker (Node.js)                  │
│                                                                  │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│   │   Classify  │───▶│  Reasoning │───▶│    Tool    │──┐        │
│   │    Node    │    │    Node    │    │    Node   │  │        │
│   └─────────────┘    └─────────────┘    └─────────────┘  │        │
│                                                          ▼        │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│   │  Greeting  │    │ Evaluation │◀────│  Follow-up │         │
│   │    Node    │    │    Node    │    │  Schedule │         │
│   └─────────────┘    └─────────────┘    └─────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                         │
│                                                                  │
│   Borrower  ──▶  ConversationMessage  ──▶  AgentState            │
│                                                                  │
│   ProcessedMessage (idempotency + failure recovery)             │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Graph Flow

1. **Greeting Flow**: Initiates outbound greetings for new borrowers
2. **Classify Node**: Detects borrower intent (payment, dispute, inquiry, etc.)
3. **Reasoning Node**: Generates context-aware response strategy
4. **Tool Node**: Executes financial calculations, offer generation
5. **Evaluation Node**: Determines if conversation is resolved
6. **Follow-up Scheduling**: Queues next action for unresolved cases

### Key Features

- **Idempotency**: ProcessedMessage table prevents duplicate processing
- **Circuit Breaker**: LLM failure protection with auto-retry
- **Timeout Handling**: Configurable LLM and execution timeouts
- **Distributed Locking**: Redis-based locks prevent concurrent processing per borrower
- **Retry Logic**: Automatic retry for transient failures

## Folder Structure

```
lakeline/
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/          # Prisma migrations
├── scripts/
│   ├── reset-db.ts         # Database reset script
│   ├── seedBorrowers.ts    # Seed test borrowers
│   └── test-agent.ts      # Test agent with sample input
├── src/
│   ├── app/                # Next.js App Router
│   │   ├── api/
│   │   │   └── conversations/   # REST API endpoints
│   │   ├── conversations/  # Conversation dashboard UI
│   │   ├── globals.css    # Global styles
│   │   └── layout.tsx     # Root layout
│   ├── agent/              # AI Agent implementation
│   │   ├── graph.ts        # LangGraph agent definition
│   │   ├── state.ts        # Agent state types
│   │   ├── tools.ts        # Agent tools definitions
│   │   └── nodes/          # Graph nodes
│   │       ├── classify.ts
│   │       ├── greeting.ts
│   │       ├── reasoning.ts
│   │       ├── tools.ts
│   │       └── evaluation.ts
│   └── lib/                # Shared utilities
│       ├── prisma.ts       # Prisma client
│       ├── llm.ts         # LLM client
│       ├── queue.ts       # Redis queue operations
│       ├── worker.ts     # BullMQ worker
│       ├── circuit-breaker.ts
│       ├── llm-timeout.ts
│       └── agent-state.ts
├── package.json
├── next.config.ts
├── tsconfig.json
└── .env.example
```

## Database Schema

### Models

- **Borrower**: Loan recipient with debt details and status
- **ConversationMessage**: Chat history between borrower and agent
- **AgentState**: Persistent state tracking intent, sentiment, strategy, negotiation data
- **ProcessedMessage**: Idempotency log for message processing

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- pnpm (or npm/yarn)

## Local Setup

### 1. Clone and Install Dependencies

```bash
git clone <repo>
cd lakeline
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/lakeline"

# LLM Provider
# Option 1: Groq (recommended - free tier)
GROQ_API_KEY="your-groq-api-key-here"

# Redis
REDIS_HOST="localhost"
REDIS_PORT="6379"

# Worker
WORKER_CONCURRENCY="10"
```

### 3. Set Up Database

```bash
# Create the database
createdb lakeline

# Run migrations
npx prisma migrate deploy

# Or for development with seed
npx prisma migrate dev --name init
```

### 4. Seed Test Data

```bash
# Seed borrowers with sample data
npm run seed:borrowers
```

### 5. Start Development Server

```bash
# Terminal 1: Next.js dev server
npm run dev

# Terminal 2: Background worker
npm run worker
```

### 6. Verify Setup

- Conversations dashboard: http://localhost:3000/conversations
- API: http://localhost:3000/api/conversations

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production application |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run worker` | Start background worker |
| `npm run seed:borrowers` | Seed test borrowers |
| `npm run test:agent` | Test agent with sample input |


## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `GROQ_API_KEY` | Groq API key (for free LLM) | Yes* |
| `REDIS_HOST` | Redis host | Yes |
| `REDIS_PORT` | Redis port | Yes |
| `WORKER_CONCURRENCY` | Worker concurrency | No (default: 10) |

*Must supply at least one LLM provider API key.

## Troubleshooting

### Worker not processing jobs

- Ensure Redis is running: `redis-cli ping`
- Check queue: `GET agent-queue:active`
- Review worker logs for errors

### LLM errors

- Verify API key in `.env`
- Check circuit breaker status in logs
- Review timeout settings in `llm-timeout.ts`

### Database connection

- Verify `DATABASE_URL` format
- Ensure PostgreSQL is running
- Check Prisma connection: `npx prisma studio`
