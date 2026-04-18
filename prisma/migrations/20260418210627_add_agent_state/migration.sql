-- CreateTable
CREATE TABLE "AgentState" (
    "id" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sentiment" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "strategy" TEXT NOT NULL DEFAULT '',
    "iterationCount" INTEGER NOT NULL DEFAULT 0,
    "lastAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "negotiationData" JSONB NOT NULL DEFAULT '{}',
    "retryData" JSONB NOT NULL DEFAULT '{}',
    "lastProcessedMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentState_borrowerId_key" ON "AgentState"("borrowerId");

-- AddForeignKey
ALTER TABLE "AgentState" ADD CONSTRAINT "AgentState_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;
