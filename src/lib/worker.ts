import { Worker } from "bullmq";
import IORedis from "ioredis";
import { runAgent } from "../agent/graph";
import { acquireLock, releaseLock, LockHandle } from "../lib/queue";
import { FatalError } from "../lib/llm-timeout";

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
});

interface JobPayload {
  borrowerId: string;
  messageId: string;
  content?: string;
  systemMessage?: string;
}

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "10");
const EXECUTION_TIMEOUT_MS = 30000;

async function withExecutionTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => never
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new FatalError(`Execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

export const agentWorker = new Worker(
  "agent-queue",
  async (job) => {
    const startTime = Date.now();
    const { borrowerId, messageId, content, systemMessage } = job.data as JobPayload;

    console.log(`[Worker] Processing job ${job.id} for borrower ${borrowerId}`);

    let lockHandle: LockHandle | null = null;

    try {
      lockHandle = await acquireLock(connection, borrowerId);

      if (!lockHandle) {
        console.log(`[Worker] Lock contention for borrower ${borrowerId}, delaying job`);
        await job.moveToDelayed(Date.now() + 1000);
        return;
      }

      const result = await withExecutionTimeout(
        runAgent({
          borrowerId,
          messageId,
          content,
          systemMessage,
        }),
        EXECUTION_TIMEOUT_MS,
        () => {
          throw new FatalError(`Global execution timeout of ${EXECUTION_TIMEOUT_MS}ms exceeded`);
        }
      );

      const duration = Date.now() - startTime;
      console.log(`[Worker] Completed job ${job.id} in ${duration}ms: ${result.substring(0, 50)}...`);

      return result;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      
      if (err instanceof FatalError) {
        console.error(`[Worker] Job ${job.id} timed out after ${duration}ms`);
        throw err;
      }

      console.error(`[Worker] Job ${job.id} failed after ${duration}ms:`, err.message);
      throw err;
    } finally {
      if (lockHandle) {
        await releaseLock(connection, borrowerId, lockHandle);
      }
    }
  },
  {
    connection,
    concurrency,
  }
);

agentWorker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

agentWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

agentWorker.on("error", (err) => {
  console.error("[Worker] Worker error:", err);
});

export async function closeWorker(): Promise<void> {
  await agentWorker.close();
  await connection.quit();
}

export { connection };