import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const borrowers = await prisma.borrower.findMany({
    include: {
      agentState: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const borrowersWithCounts = await Promise.all(
    borrowers.map(async (borrower) => {
      const count = await prisma.conversationMessage.count({
        where: { borrowerId: borrower.id },
      });
      return {
        ...borrower,
        messageCount: count,
        latestMessage: borrower.messages[0] || null,
      };
    })
  );

  const sorted = borrowersWithCounts.sort((a, b) => {
    const aTime = a.latestMessage?.createdAt?.getTime() || 0;
    const bTime = b.latestMessage?.createdAt?.getTime() || 0;
    return bTime - aTime;
  });

  return NextResponse.json(sorted);
}