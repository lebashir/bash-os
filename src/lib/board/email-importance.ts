import { generateObject } from "ai";
import { z } from "zod";
import { CHAT_MODEL_ID, google } from "@/lib/gemini/client";

// Score below this threshold means "don't surface this email as a task at
// intake time". Lives here, not in the DB, so prompt and threshold can be
// retuned without a migration.
export const IMPORTANCE_THRESHOLD = 4;

// Default returned when scoring fails (network error, model timeout, schema
// mismatch). Admit the message rather than risk silently dropping something
// important. The user can drop it manually if it turns out to be noise.
const FAILURE_DEFAULT_SCORE = 5;
const FAILURE_DEFAULT_REASON = "scoring-failed";

const SCORING_SYSTEM_PROMPT = `You triage Bashir's inbox for a personal kanban. For each email, return an integer importance score from 1 to 10 plus a one-sentence reason.

Rubric:
- 9-10: Direct action required from Bashir. Personal message from a real human asking for a decision, reply, review, or showing up somewhere. Time-sensitive deadlines named by name. One-to-one messages to Bashir from a person he knows.
- 7-8: Probably needs attention this week. Work updates that mention Bashir specifically, calendar invites where he's a required attendee, security/account notifications affecting his accounts, bills with a near-term due date.
- 5-6: Maybe relevant — calendar invites where he's optional, FYI updates from colleagues, status changes on tickets he's watching, receipts that may need to be saved.
- 3-4: Probably skippable but not obviously junk — newsletters from sources he subscribed to, generic team-wide announcements, automated digest emails, CC chains where Bashir isn't the addressee.
- 1-2: Marketing. Promotional offers. Bulk-mail with unsubscribe footers. Cold sales outreach. Anything that screams "do not read."

Signals to weigh:
- Sender relationship: is "from" a real human writing personally, an automated system, or a bulk sender? Personal humans trend higher.
- Action verbs in the body or subject ("please review", "RSVP by", "can you", "blocker"). Strong action verbs trend higher.
- Specific calendar/deadline mentions (a date, a time, "by Friday"). Trend higher when paired with Bashir being the recipient.
- Marketing markers: unsubscribe links, promotional subject lines, "% off", "limited time", bulk-mail List-Unsubscribe headers in From, "no-reply" senders without an attached human action. Trend lower.
- CC chains (Bashir is one of many recipients) trend lower unless the body addresses him by name.

Return only the JSON object: { "score": <integer 1-10>, "reason": "<one short phrase, under 80 chars>" }.`;

const scoreSchema = z.object({
  score: z.number().int().min(1).max(10),
  reason: z.string().trim().min(1).max(200),
});

export type EmailScoreInput = {
  subject: string;
  from: string;
  snippet: string;
};

export type EmailScore = {
  score: number;
  reason: string;
};

export async function scoreEmailImportance(
  input: EmailScoreInput,
  opts: { messageId?: string } = {},
): Promise<EmailScore> {
  try {
    const { object } = await generateObject({
      model: google(CHAT_MODEL_ID),
      schema: scoreSchema,
      system: SCORING_SYSTEM_PROMPT,
      prompt: renderEmail(input),
      temperature: 0.1,
      maxOutputTokens: 200,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      },
    });
    return { score: object.score, reason: object.reason };
  } catch (err) {
    console.warn(
      `[email-importance] scoring failed for ${opts.messageId ?? "(unknown)"}:`,
      err instanceof Error ? err.message : err,
    );
    return { score: FAILURE_DEFAULT_SCORE, reason: FAILURE_DEFAULT_REASON };
  }
}

function renderEmail(input: EmailScoreInput): string {
  const subject = input.subject.trim() || "(no subject)";
  const from = input.from.trim() || "(unknown sender)";
  const snippet = input.snippet.trim().slice(0, 800) || "(no preview)";
  return [
    `Subject: ${subject}`,
    `From: ${from}`,
    `Preview: ${snippet}`,
    "",
    "Return the JSON object now.",
  ].join("\n");
}
