import { revalidatePath } from "next/cache";
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import {
  buildAgent,
  buildAgentMessages,
  saveChatMessage,
} from "@/lib/board/chat";

// Streaming runs longer than the default 60s; allow up to 5 minutes.
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const parsed = body as { message?: UIMessage };
  if (!parsed.message) {
    return new Response("Missing message", { status: 400 });
  }

  const userText = extractText(parsed.message);
  if (!userText) {
    return new Response("Message is empty", { status: 400 });
  }

  // Persist the user turn before invoking the model so it survives a
  // streaming failure mid-flight.
  await saveChatMessage(supabase, user.id, "user", userText);

  const messages = await buildAgentMessages(supabase, user.id, userText);
  const agent = buildAgent(supabase, user.id);
  const result = await agent.stream({ messages });

  // Drain to completion even on client disconnect so the assistant message
  // still gets persisted via onFinish.
  result.consumeStream();

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted) return;
      if (responseMessage.role !== "assistant") return;
      const text = extractText(responseMessage);
      if (!text) return;
      await saveChatMessage(supabase, user.id, "assistant", text);
      revalidatePath("/board");
    },
  });
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}
