const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiPart = { text: string };
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

export type GeminiGenerateInput = {
  systemInstruction?: string;
  userPrompt: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  // Gemini 2.5 models think before answering by default; thinking tokens
  // count against maxOutputTokens. Pass a budget (0 = disabled) when the
  // task doesn't need reasoning — e.g. short summarization.
  thinkingBudget?: number;
};

export async function geminiGenerate(
  input: GeminiGenerateInput,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured.");
  }

  const model = input.model ?? DEFAULT_MODEL;
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;

  const contents: GeminiContent[] = [
    { role: "user", parts: [{ text: input.userPrompt }] },
  ];

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: input.maxOutputTokens ?? 2048,
    temperature: input.temperature ?? 0.4,
  };
  if (input.thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: input.thinkingBudget };
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig,
  };
  if (input.systemInstruction) {
    body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

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
    throw new Error(`Gemini API ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked the prompt: ${blockReason}`);
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const reason = candidate?.finishReason ?? "no candidates";
    throw new Error(`Gemini returned an empty response (finish: ${reason}).`);
  }
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(
      `Gemini output was truncated (finish: ${candidate.finishReason}). Raise maxOutputTokens or lower thinkingBudget.`,
    );
  }
  return text;
}
