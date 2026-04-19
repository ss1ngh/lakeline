import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function reset() {
  console.log("Deleting processed messages...");
  await prisma.processedMessage.deleteMany({});

  console.log("Deleting conversation messages...");
  await prisma.conversationMessage.deleteMany({});

  console.log("Deleting agent states...");
  await prisma.agentState.deleteMany({});

  console.log("Resetting borrower statuses...");
  await prisma.borrower.updateMany({
    data: { status: "PENDING" },
  });

  console.log("Reset complete!");
  await prisma.$disconnect();
  process.exit(0);
}

reset().catch(async (err) => {
  console.error("Error:", err);
  await prisma.$disconnect();
  process.exit(1);
});