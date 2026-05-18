import { createGoogleGenerativeAI } from "@ai-sdk/google";

// Bash OS uses GEMINI_API_KEY (set during R2 bootstrap); the SDK's default
// env var is GOOGLE_GENERATIVE_AI_API_KEY, so we wire it explicitly.
export const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const CHAT_MODEL_ID = "gemini-3-flash";
export const EMBEDDING_MODEL_ID = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 1536;
