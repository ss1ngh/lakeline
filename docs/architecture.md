# Debt Recovery Agent Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              LAKELINE DEBT RECOVERY AGENT                           │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────────┐
                                    │   WhatsApp/Twilio │
                                    │  Webhook Handler  │
                                    └────────┬────────┘
                                             │
                                   POST /api/webhooks
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    API LAYER                                        │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐               │
│  │ conversations    │    │ conversations   │    │ conversations    │               │
│  │ /route.ts       │    │ /[id]/route.ts │    │ /[id]/send     │               │
│  │ (list all)      │    │ (get history)  │    │ (send message)  │               │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    WORKER LAYER                                     │
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐    │
│   │                         runAgent(input: JobPayload)                           │    │
│   │                                                                             │    │
│   │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌────────────┐  │    │
│   │  │  PHASE 1    │───▶│  PHASE 2    │───▶│  PHASE 3    │───▶│  SCHEDULE  │  │    │
│   │  │ (Load Data) │    │ (LLM Nodes)  │    │ (Save +     │    │  Follow-   │  │    │
│   │  │            │    │            │    │  Respond)   │    │  Up)       │  │    │
│   │  └─────────────┘    └─────────────┘    └─────────────┘    └────────────┘  │    │
│   └─────────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                             │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    │                              │                              │
                    ▼                              ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    PHASE 1 - DATA LOAD                              │
│                                                                                      │
│   1. Check if message already processed (idempotency)                            │
│   2. Mark message as PROCESSING                                                    │
│   3. Save incoming message to conversation_message table                         │
│   4. Load borrower data (totalDebt, minimumAccept)                                 │
│   5. Load agentState (intent, sentiment, strategy, negotiationData)             │
│   6. Load last 10 messages (conversation history)                                   │
│   7. Convert messages to LangChain objects (HumanMessage/AIMessage)              │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    PHASE 2 - LLM PROCESSING                         │
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐ │
│   │                         classifyIntentNode(state)                            │ │
│   │  Input:  messages                                                         │ │
│   │  LLM:    Classifies intent → PAY_FULL | PAY_PARTIAL | REFUSE | DELAY     │ │
│   │              | MANIPULATE | UNKNOWN                                      │ │
│   │  Output: intent, sentiment, borrowerProposedAmount, negotiationHistory   │ │
│   └─────────────────────────────────────────────────────────────────────────────┘ │
│                                            │                                       │
│                                            ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────┐ │
│   │                         strategyNode(state)                               │ │
│   │  Intent Mapping:                                                          │ │
│   │    PAY_FULL    → ACCEPT_FULL                                            │ │
│   │    PAY_PARTIAL → NEGOTIATE_INITIAL (first time)                        │ │
│   │                  NEGOTIATE_COUNTER (subsequent)                        │ │
│   │    REFUSE      → ESCALATE                                               │ │
│   │    DELAY       → FOLLOW_UP                                              │ │
│   │    MANIPULATE  → DEFLECT                                                │ │
│   │  Output: strategy                                                        │ │
│   └─────────────────────────────────────────────────────────────────────────────┘ │
│                                            │                                       │
│                                            ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────┐ │
│   │                         decisionNode(state)                               │ │
│   │  Input:  totalDebt, softFloor, negotiationHistory                         │ │
│   │  LLM:    Decides next financial move                                       │ │
│   │  Rules:  INITIAL = 90% of debt, COUNTER ≥ softFloor                        │ │
│   │  Output: decisionProposedAmount, decisionShouldEscalate,                   │ │
│   │          decisionShouldFollowUp                                           │ │
│   └─────────────────────────────────────────────────────────────────────────────┘ │
│                                            │                                       │
│                                            ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────┐ │
│   │                         constraintNode(state)                            │ │
│   │  Business Rules:                                                         │ │
│   │    NEGOTIATE_INITIAL → 90% of debt (initialOfferAmount)                 │ │
│   │    NEGOTIATE_COUNTER → Meet in middle OR step down by $1k-5k             │ │
│   │    Step sizes: debt < 10k → $500, < 50k → $1k, < 100k → $2k,              │ │
│   │                       < 250k → $3k, ≥ 250k → $5k                         │ │
│   │    Floor: minimumAccept (cannot go below)                                  │ │
│   │  Output: constraintResult, totalConceded, negotiationHistory (with offers)│ │
│   └─────────────────────────────────────────────────────────────────────────────┘ │
│                                            │                                       │
│                                            ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────┐ │
│   │                         evaluationNode(state)                            │ │
│   │  Determines if conversation is resolved or needs follow-up               │ │
│   │    ACCEPT_FULL, ESCALATE → isResolved = true                             │ │
│   │    FOLLOW_UP, DEFLECT   → isResolved = false                            │ │
│   │  Output: isResolved, lastAction, iterationCount                           │ │
│   └─────────────────────────────────────────────────────────────────────────────┘ │
│                                            │                                       │
│                            ┌───────────────┴───────────────┐                    │
│                            │                               │                    │
│                            ▼                               ▼                    │
│              ┌─────────────────────────┐    ┌───────────────────────���─────┐    │
│              │    LastAction =          │    │    LastAction =             │    │
│              │    OFFER_SENT            │    │    WAITING_RESPONSE         │    │
│              └────────────┬────────────┘    └──────────────┬──────────────┘    │
│                           │                                  │                     │
│                           ▼                                  ▼                     │
│              ┌─────────────────────────┐    ┌─────────────────────────────┐    │
│              │    responseNode(state)  │    │    responseNode(state)      │    │
│              │                         │    │                         │    │
│              │  NEGOTIATE_INITIAL/COUNTER│   │  FOLLOW_UP                 │    │
│              │  - Include discount %    │    │  - Empathy first           │    │
│              │  - Include final amount │    │  - Ask about situation    │    │
│              │  - Natural language     │    │  - Don't offer payment    │    │
│              │                         │    │    plan immediately       │    │
│              │  Output: response       │    │  Output: response         │    │
│              └─────────────────────────┘    └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    PHASE 3 - SAVE & RESPOND                         │
│                                                                                      │
│   1. Save agentState (intent, sentiment, strategy, iterationCount,                    │
│                     negotiationData, nextActionAt)                                  │
│   2. Save agent response to conversation_message                                   │
│   3. Mark processedMessage as DONE                                                  │
│   4. If nextActionAt set → scheduleFollowUp() via BullMQ                           │
│   5. Return response to API → Send via Twilio                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATABASE SCHEMA                                  │
│                                                                                      │
│   ┌─────────────┐       ┌───────────────────┐       ┌─────────────────��            │
│   │  Borrower   │       │ Conversation     │       │  Processed     │            │
│   │            │◀─────▶│   Message       │       │    Message    │            │
│   │  id        │       │  id             │       │  id           │            │
│   │  name      │       │  borrowerId      │◀─────▶│  borrowerId   │            │
│   │  phone     │       │  role           │       │  status      │            │
│   │  totalDebt │       │  content        │       │  content     │            │
│   │  minimum  │       │  createdAt      │       │  createdAt   │            │
│   │   Accept  │       └───────────────────┘       └─────────────────┘            │
│   │  status   │                                                              │
│   └─────────────┘                                                              │
│          │                                                                    │
│          │ 1:1                                                                 │
│          ▼                                                                    │
│   ┌─────────────┐                                                              │
│   │ AgentState │                                                              │
│   │           │                                                              │
│   │ borrowerId│◀──── Primary Key                                               │
│   │ intent   │                                                                │
│   │ sentiment│                                                                │
│   │ strategy │                                                                │
│   │ iteration│                                                                │
│   │ lastAction│                                                               │
│   │ nextAction│   (scheduled follow-up timestamp)                                │
│   │ negotiation│                                                              │
│   │   Data   │ (offers[], lastOffer, totalConceded, softFloor, etc.)            │
│   └─────────────┘                                                              │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    MESSAGE EXAMPLES                                │
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐       │
│   │  NEGOTIATE_INITIAL                                                  │       │
│   │  ─────────────────                                                │       │
│   │  Customer: "I'll pay $5000 next month."                          │       │
│   │  Agent: "So here's what I can do — we can lower the whole amount       │       │
│   │           by 10% and your final amount would be $222,769.          │       │
│   │           I can settle this for $222,769 if we can close it           │       │
│   │           out this week. How does that sound?"                    │       │
│   └─────────────────────────────────────────────────────────────────────┘       │
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐       │
│   │  FOLLOW_UP (Customer can't pay)                                     │       │
│   │  ────────────────────────────────                                   │       │
│   │  Customer: "I can't afford to pay right now."                       │       │
│   │  Agent: "I completely understand — these situations are tough.      │       │
│   │         Can you tell me a bit more about what's going on? Even if        │       │
│   │         it's just temporary, I'd like to help find a way forward."        │       │
│   └─────────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    ERROR HANDLING                                 │
│                                                                                      │
│   Circuit Breaker Pattern:                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────┐       │
│   │  LLM Call Fails                                                    │       │
│   │       │                                                            │       │
│   │       ▼                                                            │       │
│   │  Record failure → Increment failure count                             │       │
│   │       │                                                            │       │
│   │       ▼                                                            │       │
│   │  If failures > threshold (5) → Open circuit (skip LLM)               │       │
│   │       │                                                            │       │
│   │       ▼                                                            │       │
│   │  Return hardcoded fallback responses                                 │       │
│   └─────────────────────────────────────────────────────────────────────────┘       │
│                                                                                      │
│   Timeout Handling:                                                               │
│   - LLM calls wrapped with withTimeout (10-15 seconds)                           │
│   - If timeout → RetryableError → Message requeued for retry                        │
│                                                                                      │
│   Retry Strategy:                                                                │
│   - Max 3 retries per message                                                   │
│   - Exponential backoff                                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘