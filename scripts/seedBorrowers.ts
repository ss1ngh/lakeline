import "dotenv/config";
import fs from "fs";
import csv from "csv-parser";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface Args {
  dry?: boolean;
  limit?: number;
}

function parseArgs(): Args {
  const args: Args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg === "--dry") {
      args.dry = true;
    } else if (arg.startsWith("--limit=")) {
      args.limit = parseInt(arg.split("=")[1], 10);
    }
  });
  return args;
}

interface CsvRow {
  name: string;
  phone: string;
  totalDebt: string;
  minimumAccept: string;
  status?: string;
}

interface ValidationResult {
  valid: boolean;
  row: CsvRow;
  reason?: string;
}

function validateRow(row: CsvRow): ValidationResult {
  const name = row.name?.trim();
  const phone = row.phone?.trim();
  const totalDebt = parseFloat(row.totalDebt);
  const minimumAccept = parseFloat(row.minimumAccept);

  if (!name) {
    return { valid: false, row, reason: "missing name" };
  }

  if (!phone) {
    return { valid: false, row, reason: "missing phone" };
  }

  if (isNaN(totalDebt) || totalDebt <= 0) {
    return { valid: false, row, reason: `invalid totalDebt: ${row.totalDebt}` };
  }

  if (isNaN(minimumAccept) || minimumAccept <= 0) {
    return { valid: false, row, reason: `invalid minimumAccept: ${row.minimumAccept}` };
  }

  if (minimumAccept > totalDebt) {
    return { valid: false, row, reason: "minimumAccept > totalDebt" };
  }

  return {
    valid: true,
    row: { name, phone, totalDebt: String(totalDebt), minimumAccept: String(minimumAccept) },
  };
}

async function upsertBorrower(
  data: { name: string; phone: string; totalDebt: number; minimumAccept: number },
  dry: boolean
): Promise<boolean> {
  if (dry) {
    console.log(`[DRY] Would upsert: ${data.phone} - ${data.name}`);
    return true;
  }

  try {
    await prisma.borrower.upsert({
      where: { phone: data.phone },
      update: {},
      create: {
        name: data.name,
        phone: data.phone,
        totalDebt: data.totalDebt,
        minimumAccept: data.minimumAccept,
        status: "PENDING",
      },
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      console.warn(`Duplicate phone: ${data.phone}`);
      return false;
    }
    throw error;
  }
}

async function processBatch(
  rows: CsvRow[],
  dry: boolean,
  batchSize: number
): Promise<{ inserted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (row) => {
        const validation = validateRow(row);
        if (!validation.valid) {
          console.warn(`Skipping invalid row: ${validation.reason}`);
          return false;
        }
        return upsertBorrower(
          {
            name: validation.row.name,
            phone: validation.row.phone,
            totalDebt: parseFloat(validation.row.totalDebt),
            minimumAccept: parseFloat(validation.row.minimumAccept),
          },
          dry
        );
      })
    );

    for (const result of results) {
      if (result) {
        inserted++;
      } else {
        failed++;
      }
    }
  }

  return { inserted, failed };
}

async function main() {
  const args = parseArgs();
  const startTime = Date.now();

  console.log(`Starting seed with args:`, args);

  const csvPath = "borrowers.csv";

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const rows: CsvRow[] = [];
  let skipped = 0;
  let totalProcessed = 0;

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row: CsvRow) => {
        totalProcessed++;
        const validation = validateRow(row);
        if (validation.valid) {
          if (args.limit && rows.length >= args.limit) {
            return;
          }
          rows.push(validation.row);
        } else {
          skipped++;
          console.warn(`Invalid row at line ${totalProcessed + 1}: ${validation.reason}`);
        }
      })
      .on("end", () => resolve())
      .on("error", (error) => reject(error));
  });

  console.log(`Processed ${totalProcessed} rows, valid: ${rows.length}, skipped: ${skipped}`);

  const BATCH_SIZE = 50;
  const result = await processBatch(rows, args.dry ?? false, BATCH_SIZE);

  const durationMs = Date.now() - startTime;

  console.log({
    total: totalProcessed,
    inserted: result.inserted,
    skipped,
    failed: result.failed,
    durationMs,
  });

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("Seed failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});