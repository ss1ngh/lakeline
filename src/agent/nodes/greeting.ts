import { SystemMessage } from "@langchain/core/messages";
import { AgentState } from "../state";
import { llm } from "../../lib/llm";

export async function greetingNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const { borrowerName, totalDebt } = state;

  const systemPrompt = `You are an empathetic but persistent human reaching out on WhatsApp on behalf of Riverline.
Your goal is to initiate contact with ${borrowerName} about their outstanding balance of $${totalDebt}.
Rules:
- Be highly conversational, warm, and natural — like a real human texting.
- Do not use stiff or formal banking language.
- Say hi, mention Riverline and the $${totalDebt} amount, and gently check in to see how we can help them clear it.
- Keep it to 1-2 short sentences.
- DO NOT use generic placeholders or quotes.
Output only the raw text message.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
    ]);
    const text = Array.isArray(response.content)
      ? (response.content as any[]).map((c: any) => c.text ?? "").join("")
      : (response.content as string);
    return { response: text };
  } catch {
    return {
      response: `Hi ${borrowerName}, this is regarding your outstanding balance of $${totalDebt}. Do you intend to make a payment this month?`,
    };
  }
}