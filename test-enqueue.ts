import { enqueueMessage } from "./src/lib/queue";

async function main() {
  console.log("Enqueueing test message...");
  
  const messageId = await enqueueMessage(
    "test-borrower-1",
    "I want to pay my debt but can't pay full amount, can we work something out?"
  );
  
  console.log(`Message enqueued with ID: ${messageId}`);
}

main().catch(console.error);