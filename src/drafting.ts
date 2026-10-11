// Lucidity Intelligence: turns a clinician's short note ("dim the lights
// tonight") into a warm, plain-language message for the caregiver. The
// clinician always sees the draft next to their own note and must approve
// the exact text; if drafting fails, the clinician's own words are used.

import { generateText } from "ai";
import { sessionHeaders, type LlmConfig } from "./llm.ts";

export interface DraftInput {
  type: "question" | "recommendation";
  /** The clinician's note, as typed. */
  note: string;
  /** How the caregiver refers to the patient ("Dad"). */
  patientLabel: string;
  /** The caregiver's most recent words, for a brief acknowledgment (optional). */
  recentQuote?: string;
}

const MAX_CHARS = 320;

export function draftingPrompt(input: DraftInput): string {
  return [
    `Rewrite the care team's note as one short text message to a family caregiver of someone with dementia (the caregiver calls them "${input.patientLabel}").`,
    "Rules:",
    "- Keep the clinician's meaning exactly. Do not add any advice, steps, or facts that aren't in the note.",
    "- Plain, warm, everyday words. No medical terms, no diagnosis, no medication, doses, or timing advice.",
    "- 1 to 3 short sentences, under 45 words. No greeting, no sign-off, no quotation marks, no emoji.",
    input.recentQuote
      ? `- You may start with a brief, kind acknowledgment of what the caregiver shared ("${input.recentQuote}"), in under 8 words.`
      : "- You may start with a brief, kind acknowledgment.",
    input.type === "recommendation"
      ? '- End with exactly: "Want to try it? Reply YES, or skip."'
      : "- It must end as a single, clear question the caregiver can answer.",
    "Reply with only the message text.",
    "",
    `Care team's note (${input.type}): ${input.note}`,
  ].join("\n");
}

/** Cleans and checks a model draft; null if it isn't usable. */
export function acceptDraft(text: string, input: DraftInput): string | null {
  const draft = text
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!draft || draft.length > MAX_CHARS) return null;
  if (input.type === "question" && !draft.endsWith("?")) return null;
  if (input.type === "recommendation" && !/reply yes, or skip\.?$/i.test(draft)) return null;
  // Never introduce medication/dose language the clinician didn't write.
  const meds = /\b(mg|dose|dosage|medication|medicine|pill|tablet|prescri)/i;
  if (meds.test(draft) && !meds.test(input.note)) return null;
  return draft;
}

/** Drafts the caregiver-facing text, or null (caller falls back to the note). */
export async function draftCareMessage(llm: LlmConfig, input: DraftInput): Promise<string | null> {
  try {
    const result = await generateText({
      model: llm.model,
      providerOptions: llm.providerOptions,
      headers: sessionHeaders("care-drafting"),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(30_000),
      prompt: draftingPrompt(input),
    });
    return acceptDraft(result.text, input);
  } catch (err) {
    console.error("[lucidity.care] drafting failed; using the clinician's words", err);
    return null;
  }
}
