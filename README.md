# Lakeline

An AI-powered debt collection agent that autonomously manages borrower conversations. Unlike a standard stateless chatbot, Lakeline operates as a **distributed AI system** using a **stateful, tool-using agent graph** built on LangGraph.

It is designed to:

- Understand borrower intent accurately.
- Plan responses using logical reasoning.
- Execute specific financial tools (e.g., settlements, payment plans).
- Maintain persistent conversation state across multiple interactions.
- Automatically schedule and trigger follow-ups.

---

### To understand how Lakeline operates, view it as a distributed workflow system separated into distinct layers:

- **API (Ingestion):** Receives user input and webhooks.
- **Queue (Buffer):** Holds pending tasks to ensure no messages are dropped during high traffic.
- **Worker (Execution Engine):** Consumes queue jobs and runs the LangGraph AI logic in the background.
- **Database (Memory):** Stores long-term state, chat history, and idempotency keys to prevent duplicate actions.

---

## 💻 Tech Stack

| Layer          | Technology              |
| :------------- | :---------------------- |
| **Framework**  | Next.js                 |
| **Language**   | TypeScript              |
| **UI**         | React + Tailwind CSS    |
| **Database**   | PostgreSQL + Prisma ORM |
| **Queue**      | BullMQ                  |
| **Cache**      | Redis                   |
| **AI Runtime** | LangGraph + LangChain   |
| **LLM**        | Groq / OpenAI           |

---

## 🏗️ Architecture

```text
┌──────────────────────────────────────────────┐
│                Next.js App                   │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │  API Layer (Conversations)           │   │
│   │  /api/conversations/:id/send         │   │
│   └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│            Redis Queue (BullMQ)              │
│                agent-queue                   │
└──────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│          Background Worker (Node.js)         │
│                                              │
│   ┌──────────────┐   ┌──────────────┐        │
│   │  Classify    │ → │  Reasoning   │        │
│   └──────────────┘   └──────────────┘        │
│            │                 │               │
│            ▼                 ▼               │
│      ┌──────────────┐   ┌──────────────┐     │
│      │    Tools     │ → │  Evaluation  │     │
│      └──────────────┘   └──────────────┘     │
│                             │                │
│                             ▼                │
│                    Follow-up Scheduler       │
└──────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│              PostgreSQL Database             │
│                                              │
│  Borrower → Messages → AgentState            │
│  ProcessedMessage (idempotency layer)        │
└──────────────────────────────────────────────┘
```

### Agent Flow

The internal LangGraph agent executes through the following node sequence:

- **Greeting Node:** Initiates the interaction.
- **Classify Node:** Detects the borrower's intent (e.g., PAY, REFUSE, DELAY).
- **Reasoning Node:** Evaluates the intent and plans a conversation strategy.
- **Tool Node:** Executes necessary financial logic or API calls.
- **Evaluation Node:** Determines if the interaction reached a resolution.
- **Follow-up Scheduler:** Re-enqueues the interaction into BullMQ if the conversation is unresolved.

---

## 🛠️ Local Setup Guide

The system requires Node.js 18+, PostgreSQL 14+, and Redis 6+. Run the following commands in order to configure your local environment.

### 1. Clone & Install

```bash
git clone [https://github.com/](https://github.com/)<your-username>/lakeline.git
cd lakeline
npm install
```

### 2. Copy the example environment file and update it with your local credentials.

```bash
cp .env.example .env
```

### Edit .env to include:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/lakeline"
REDIS_HOST="localhost"
REDIS_PORT="6379"
GROQ_API_KEY="your_api_key_here"
WORKER_CONCURRENCY="10"
```

### 3. Ensure PostgreSQL is running, then execute the following sequentially to build the schema, reset the environment, and populate test data.

```bash
# Create the database (requires PostgreSQL CLI)
createdb lakeline

# Push schema to the database
npx prisma migrate dev --name init

# Reset the database to a clean state
npx tsx scripts/reset-db.ts

# Seed the database with initial borrower data
npm run seed:borrowers
```

### 4. Open three separate terminals in the root directory and execute the following:

#### Terminal 1: The Background Worker

This process consumes jobs from Redis and runs the LangGraph agent.

```bash
npm run worker
```

#### Terminal 2: The Web App

This starts the Next.js development server to view the UI.

```bash
npm run dev
```

#### Terminal 3: Enqueue Jobs (Test Agent)

Use this command to create test conversations, push them to the Redis queue, and trigger the agent's outbound greeting.

```bash
npm run test:agent -- --limit=5
```

#### Access the application at: http://localhost:3000/conversations and start chatting as the customer.

## 📂Folder Structure

```bash
lakeline/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   ├── reset-db.ts
│   ├── seedBorrowers.ts
│   └── test-agent.ts
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── conversations/
│   │   ├── conversations/
│   │   ├── globals.css
│   │   └── layout.tsx
│   ├── agent/
│   │   ├── graph.ts
│   │   ├── state.ts
│   │   ├── tools.ts
│   │   └── nodes/
│   │       ├── classify.ts
│   │       ├── greeting.ts
│   │       ├── reasoning.ts
│   │       ├── tools.ts
│   │       └── evaluation.ts
│   └── lib/
│       ├── prisma.ts
│       ├── llm.ts
│       ├── queue.ts
│       ├── worker.ts
│       ├── circuit-breaker.ts
│       ├── llm-timeout.ts
│       └── agent-state.ts
├── package.json
├── next.config.ts
├── tsconfig.json
└── .env.example

```

## Future Improvements

- Multi-channel communication support (SMS, WhatsApp, Email).
- Direct payment gateway integration for executing settlements.
- Advanced LLM negotiation strategies utilizing dynamic context windows.
- Comprehensive operational analytics dashboard.
- Human escalation routing for edge cases.
