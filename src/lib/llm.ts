import { ChatOpenAI } from "@langchain/openai";

function getGroqModel(): ChatOpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is required");
  }

  return new ChatOpenAI({
    model: "llama-3.1-70b-versatile",
    temperature: 0.2,
    apiKey,
    configuration: {
      baseURL: "https://api.groq.com/openai/v1",
    },
  });
}

export function createLLM(): ChatOpenAI {
  return getGroqModel();
}

export const llm = createLLM();