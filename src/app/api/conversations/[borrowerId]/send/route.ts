import { NextResponse } from "next/server";
import { enqueueMessage } from "@/lib/queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ borrowerId: string }> }
) {
  const { borrowerId } = await params;
  const body = await request.json();
  const { content } = body;

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 });
  }

  try {
    const messageId = await enqueueMessage(borrowerId, content);
    return NextResponse.json({ messageId });
  } catch (error) {
    console.error("Failed to enqueue message:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}