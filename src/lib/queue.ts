import { Queue } from "bullmq";
import IORedis from "ioredis";
import crypto from "crypto";

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: 3,
});

const LOCK_TTL_MS = 30000;
const LOCK_HEARTBEAT_INTERVAL = LOCK_TTL_MS / 2;

const RENEW_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

export interface LockHandle {
  token: string;
  heartbeat: NodeJS.Timeout | null;
}

export async function acquireLock(
  redis: IORedis,
  borrowerId: string
): Promise<LockHandle | null> {
  const lockKey = `lock:borrower:${borrowerId}`;
  const token = crypto.randomUUID();
  const result = await redis.set(lockKey, token, "PX", LOCK_TTL_MS, "NX");
  
  if (result !== "OK") {
    return null;
  }

  const heartbeat = setInterval(async () => {
    try {
      await redis.eval(RENEW_SCRIPT, 1, lockKey, token, LOCK_TTL_MS);
    } catch (err) {
      console.error("[Lock] Heartbeat failed:", err);
    }
  }, LOCK_HEARTBEAT_INTERVAL);

  return { token, heartbeat };
}

export async function releaseLock(
  redis: IORedis,
  borrowerId: string,
  handle: LockHandle
): Promise<void> {
  if (handle.heartbeat) {
    clearInterval(handle.heartbeat);
  }
  
  const lockKey = `lock:borrower:${borrowerId}`;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, lockKey, handle.token);
}

export async function withLock<T>(
  redis: IORedis,
  borrowerId: string,
  fn: () => Promise<T>
): Promise<T> {
  const handle = await acquireLock(redis, borrowerId);
  if (!handle) {
    throw new Error(`Borrower ${borrowerId} is already being processed`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(redis, borrowerId, handle);
  }
}

export const agentQueue = new Queue("agent-queue", { connection });

interface StandardJobPayload {
  borrowerId: string;
  messageId: string;
  content?: string;
  systemMessage?: string;
}

const JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 2000,
  },
  removeOnComplete: {
    count: 100,
    age: 3600,
  },
  removeOnFail: {
    count: 500,
    age: 86400,
  },
};

export async function enqueueMessage(
  borrowerId: string,
  content: string
): Promise<string> {
  const messageId = `msg-${borrowerId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  await agentQueue.add(
    "process-message",
    { borrowerId, messageId, content } as StandardJobPayload,
    { jobId: messageId, ...JOB_OPTIONS }
  );

  return messageId;
}

export async function enqueueFollowUp(
  borrowerId: string,
  scheduledAt?: Date
): Promise<void> {
  const messageId = `followup-${borrowerId}-${Date.now()}`;
  const jobId = `followup-${borrowerId}`;

  try {
    const existingJob = await agentQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }
  } catch {
  }

  const jobOptions = {
    jobId,
    ...JOB_OPTIONS,
  };

  if (scheduledAt) {
    const delay = scheduledAt.getTime() - Date.now();
    if (delay > 0) {
      await agentQueue.add(
        "follow-up",
        {
          borrowerId,
          messageId,
          systemMessage: "FOLLOW_UP_REMINDER",
        } as StandardJobPayload,
        { ...jobOptions, delay }
      );
      return;
    }
  }

  await agentQueue.add(
    "follow-up",
    {
      borrowerId,
      messageId,
      systemMessage: "FOLLOW_UP_REMINDER",
    } as StandardJobPayload,
    jobOptions
  );
}

export async function scheduleFollowUp(
  borrowerId: string,
  scheduledAt: Date
): Promise<void> {
  await enqueueFollowUp(borrowerId, scheduledAt);
}

export async function retryFailedMessages(): Promise<number> {
  const failedJobs = await agentQueue.getJobs("failed", 0, 100);
  let retried = 0;

  for (const job of failedJobs) {
    try {
      const { borrowerId, messageId, content, systemMessage } = job.data as StandardJobPayload;
      const newMessageId = `retry-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      await agentQueue.add(
        "process-message",
        { borrowerId, messageId: newMessageId, content, systemMessage },
        { jobId: newMessageId, ...JOB_OPTIONS }
      );
      
      retried++;
    } catch (err) {
      console.error("[Queue] Failed to retry job:", job.id, err);
    }
  }

  return retried;
}

import { PrismaClient } from "@prisma/client";

export async function retryFailedDBMessages(
  prisma: PrismaClient
): Promise<number> {
  const failedMessages = await prisma.processedMessage.findMany({
    where: { status: "FAILED" },
    take: 50,
  });

  let retried = 0;
  for (const msg of failedMessages) {
    try {
      const content = msg.content;
      const systemMessage = msg.systemMessage;

      if (!content && !systemMessage) {
        console.warn(`[Queue] No content found for failed message ${msg.id}, skipping`);
        continue;
      }

      const newMessageId = `retry-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      await agentQueue.add(
        "process-message",
        { borrowerId: msg.borrowerId, messageId: newMessageId, content, systemMessage },
        { jobId: newMessageId, ...JOB_OPTIONS }
      );
      retried++;
    } catch (err) {
      console.error("[Queue] Failed to retry DB message:", msg.id, err);
    }
  }

  return retried;
}

export async function recoverStuckMessages(
  prisma: PrismaClient,
  stuckThresholdMs: number = 5 * 60 * 1000
): Promise<number> {
  const stuckMessages = await prisma.processedMessage.findMany({
    where: {
      status: "PROCESSING",
      createdAt: {
        lt: new Date(Date.now() - stuckThresholdMs),
      },
    },
    take: 50,
  });

  let recovered = 0;
  for (const msg of stuckMessages) {
    try {
      await prisma.processedMessage.update({
        where: { id: msg.id },
        data: { status: "FAILED" },
      });

      const content = msg.content;
      const systemMessage = msg.systemMessage;

      if (!content && !systemMessage) {
        console.warn(`[Queue] No content for stuck message ${msg.id}, marking failed`);
        continue;
      }

      const newMessageId = `recover-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      await agentQueue.add(
        "process-message",
        { borrowerId: msg.borrowerId, messageId: newMessageId, content, systemMessage },
        { jobId: newMessageId, ...JOB_OPTIONS }
      );
      recovered++;
    } catch (err) {
      console.error("[Queue] Failed to recover stuck message:", msg.id, err);
    }
  }

  return recovered;
}

export async function closeQueue(): Promise<void> {
  await agentQueue.close();
  await connection.quit();
}

export { connection };