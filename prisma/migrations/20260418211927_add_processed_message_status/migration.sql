-- AlterTable
ALTER TABLE "ProcessedMessage" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PROCESSING';

-- CreateIndex
CREATE INDEX "ProcessedMessage_status_idx" ON "ProcessedMessage"("status");
