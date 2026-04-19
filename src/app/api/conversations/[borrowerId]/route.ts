import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ borrowerId: string }> }
) {
  const { borrowerId } = await params;

  const borrower = await prisma.borrower.findUnique({
    where: { id: borrowerId },
  });

  if (!borrower) {
    return NextResponse.json({ error: "Borrower not found" }, { status: 404 });
  }

  const messages = await prisma.conversationMessage.findMany({
    where: { borrowerId },
    orderBy: { createdAt: "asc" },
  });

  const agentState = await prisma.agentState.findUnique({
    where: { borrowerId },
  });

  return NextResponse.json({
    borrower,
    messages,
    agentState,
  });
}