// First-time welcome: two short, warm messages the first time a caregiver
// texts Lucidity. Written fresh by the AI each time, then checked by code for
// the things it must say (what Lucidity does, the care team, STOP, a closing
// "who are you caring for?") and must not say (monitoring/diagnosis promises).
// Falls back to fixed wording if the draft fails a check or the AI is down.

import { generateText } from "ai";
import { sessionHeaders, type LlmConfig } from "./llm.ts";

export const WELCOME_MESSAGES = [
  "Hi, I'm Lucidity 💙 I'm here to help you keep track of how your loved one is doing, so the little things don't get lost between doctor visits.",
  "Just text me in your own words, anytime: a rough night, a good moment, something that's worrying you. I'll save it for the care team, help with reminders, and if anything sounds urgent, I'll tell you right away what to do. Text STOP anytime to pause. Who are you caring for?",
];

/** A first message that's only a greeting gets just the welcome (no AI reply). */
export function isGreetingOnly(text: string): boolean {
  return /^(hi|hii+|hello|hey|heya|hiya|yo|start|hi there|hello there|hey there|good (?:morning|afternoon|evening)|test(?:ing)?)[\s!.,?👋🙂😊]*$/i.test(
    text.trim(),
  );
}

const SEPARATOR = "---";

export const WELCOME_PROMPT = [
  "Write a first-time welcome from Lucidity, a text-message companion for family caregivers of people with dementia. Write it as two separate short text messages, separated by a line containing only ---.",
  "Message 1 (under 35 words): warmly introduce yourself as Lucidity and say you help them keep track of how their loved one is doing between doctor visits. You may use one heart or similar emoji.",
  "Message 2 (under 60 words): say they can text you anytime in their own words (e.g. a rough night, a good moment, a worry); that you'll save what they share for the care team and help with reminders; that if something sounds urgent you'll tell them right away what to do; that they can text STOP anytime to pause; and end by asking who they're caring for.",
  "Warm, plain, everyday words. Vary the wording naturally. Never promise that someone is watching or monitoring, never mention diagnosis, treatment, or medication, and don't use quotation marks or headings.",
  "Reply with only the two messages and the --- line.",
].join("\n");

const FORBIDDEN = /\b(24\/7|monitor|watching|around the clock|diagnos|treat(?:ment)?|medication|prescri|guarantee|always available|doctor will)\b/i;

/** Splits and checks a model draft; null if it misses anything required. */
export function acceptWelcome(text: string): string[] | null {
  const parts = text
    .split(new RegExp(`^\\s*${SEPARATOR}+\\s*$`, "m"))
    .map((p) => p.trim().replace(/^["“]+|["”]+$/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const [first, second] = parts as [string, string];
  const all = `${first} ${second}`;
  if (!/lucidity/i.test(first)) return null;
  if (!/care team/i.test(all)) return null;
  if (!/\bSTOP\b/.test(second)) return null;
  if (!/remind/i.test(all)) return null;
  if (!/\?$/.test(second) || !/(caring for|care for|looking after|taking care of)/i.test(second.slice(-120))) return null;
  if (first.length > 260 || second.length > 420) return null;
  if (FORBIDDEN.test(all)) return null;
  return [first, second];
}

/** The two welcome messages: AI-written and checked, else the fixed wording. */
export async function welcomeMessages(llm: LlmConfig | null, caregiver: string): Promise<string[]> {
  if (!llm) return WELCOME_MESSAGES;
  try {
    const result = await generateText({
      model: llm.model,
      providerOptions: llm.providerOptions,
      headers: sessionHeaders(caregiver),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(15_000),
      prompt: WELCOME_PROMPT,
    });
    const accepted = acceptWelcome(result.text);
    if (!accepted) console.warn("[lucidity.welcome] draft failed checks; using fixed welcome");
    return accepted ?? WELCOME_MESSAGES;
  } catch (err) {
    console.error("[lucidity.welcome] drafting failed; using fixed welcome", err);
    return WELCOME_MESSAGES;
  }
}
