import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { enqueueMessage } from "../src/lib/queue";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface Args {
  limit?: number;
}

function parseArgs(): Args {
  const args: Args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--limit=")) {
      args.limit = parseInt(arg.split("=")[1], 10);
    }
  });
  return args;
}

async function main() {
  const args = parseArgs();

  const borrowers = await prisma.borrower.findMany({
    take: args.limit || 1,
    orderBy: { createdAt: "asc" },
  });

  if (borrowers.length === 0) {
    console.log("No borrowers found. Run 'npm run seed:borrowers' first.");
    process.exit(0);
  }

  console.log(`Found ${borrowers.length} borrower(s)\n`);

  for (const borrower of borrowers) {
    console.log(`Initiating outbound greeting for: ${borrower.name} (${borrower.phone})`);
    console.log(`Total debt: $${borrower.totalDebt.toLocaleString()}`);
    console.log(`Minimum acceptable: $${borrower.minimumAccept.toLocaleString()}`);

    try {
      const messageId = await enqueueMessage(borrower.id, undefined, `<INITIATE_OUTBOUND_GREETING>`);
      console.log(`✓ Outbound greeting enqueued with ID: ${messageId}`);
    } catch (err) {
      console.error("✗ Failed to enqueue message:", err);
    }

    console.log("---\n");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error:", err);
  await prisma.$disconnect();
  process.exit(1);
});