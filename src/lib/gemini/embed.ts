import { embed } from "ai";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  google,
} from "./client";

export type EmbedInput = {
  text: string;
  dimensions?: number;
  // Hint to the embedder about how the vector will be used. Gemini supports
  // values like RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY, SEMANTIC_SIMILARITY.
  taskType?: string;
};

export async function geminiEmbed(input: EmbedInput): Promise<number[]> {
  const { embedding } = await embed({
    model: google.textEmbeddingModel(EMBEDDING_MODEL_ID),
    value: input.text,
    providerOptions: {
      google: {
        outputDimensionality: input.dimensions ?? EMBEDDING_DIMENSIONS,
        ...(input.taskType ? { taskType: input.taskType } : {}),
      },
    },
  });
  if (embedding.length === 0) {
    throw new Error("Gemini returned an empty embedding.");
  }
  return embedding;
}
