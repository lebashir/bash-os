const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-embedding-001";
// Matches the memories.embedding column (vector(1536)).
const DEFAULT_DIMENSIONS = 1536;

type EmbedRequestBody = {
  content: { parts: Array<{ text: string }> };
  outputDimensionality: number;
  taskType?: string;
};

type EmbedResponse = {
  embedding?: { values?: number[] };
};

export type EmbedInput = {
  text: string;
  model?: string;
  dimensions?: number;
  // Hint to the embedder about how the vector will be used. Gemini supports
  // values like RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY, SEMANTIC_SIMILARITY.
  taskType?: string;
};

export async function geminiEmbed(input: EmbedInput): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured.");

  const model = input.model ?? DEFAULT_MODEL;
  const url = `${GEMINI_API_BASE}/models/${model}:embedContent`;

  const body: EmbedRequestBody = {
    content: { parts: [{ text: input.text }] },
    outputDimensionality: input.dimensions ?? DEFAULT_DIMENSIONS,
  };
  if (input.taskType) body.taskType = input.taskType;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini embed ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as EmbedResponse;
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini returned an empty embedding.");
  }
  return values;
}
