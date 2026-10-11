// Interprets caregiver replies to questionnaire prompts.
// Clear answers ("yes", "nope", "2") are parsed by rules. Only unclear replies
// go to the LLM, which may map them to an allowed answer or write one short
// clarification line. The LLM never rewords the official question; the
// questionnaire engine re-sends it verbatim.

import { generateText, tool } from "ai";
import { z } from "zod";
import { PART_RANGE, type Part } from "./instruments/types.ts";
import { sessionHeaders, type LlmConfig } from "./llm.ts";

export type Parsed =
  | { kind: "answer"; value: number } // presence: 1 yes / 0 no
  | { kind: "unknown" } // "don't know" — kept as unknown, never "no"
  | { kind: "skip" }
  | { kind: "unclear" };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const YES = /^(y|yes|yeah|yea|yep|yup|ya|yah|sure|correct|definitely|absolutely|he does|she does|they do|it does|true)$/;
const NO = /^(n|no|nope|nah|na|not really|no he doesn't|no she doesn't|none|never|not at all|he doesn't|she doesn't|false)$/;
const UNKNOWN = /^(idk|i don't know|dont know|don't know|not sure|unsure|i'm not sure|im not sure|no idea|can't say|cant say|n a|na idk)$/;
const SKIP = /^(skip|skip it|skip this|pass|next)$/;

// ZBI scale words (checked before numbers). "never" here means 0, not "no".
const FREQUENCY_WORDS: Array<[RegExp, number]> = [
  [/^(never|not at all|not really|no)$/, 0],
  [/^(rarely|hardly ever|seldom|once in a while)$/, 1],
  [/^(sometimes|occasionally|now and then|some)$/, 2],
  [/^(quite frequently|frequently|often|quite often|a lot)$/, 3],
  [/^(nearly always|almost always|always|all the time|constantly)$/, 4],
];

const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };

/** Deterministic parse; returns "unclear" when rules can't decide. */
export function parseAnswer(part: Part, reply: string): Parsed {
  const text = normalize(reply);
  if (!text) return { kind: "unclear" };
  if (SKIP.test(text)) return { kind: "skip" };
  if (UNKNOWN.test(text)) return { kind: "unknown" };

  if (part === "presence") {
    if (YES.test(text)) return { kind: "answer", value: 1 };
    if (NO.test(text)) return { kind: "answer", value: 0 };
    return { kind: "unclear" };
  }

  if (part === "frequency") {
    const word = FREQUENCY_WORDS.find(([re]) => re.test(text));
    if (word) return { kind: "answer", value: word[1] };
  }

  const [min, max] = PART_RANGE[part];
  // A lone number (digit or word), optionally with filler like "maybe a 2".
  const numbers = [...text.matchAll(/\b([0-9]|zero|one|two|three|four|five)\b/g)].map((m) =>
    m[1]! in NUMBER_WORDS ? NUMBER_WORDS[m[1]!]! : Number(m[1]),
  );
  const distinct = [...new Set(numbers)];
  if (distinct.length === 1 && text.split(" ").length <= 5) {
    const value = distinct[0]!;
    if (value >= min && value <= max) return { kind: "answer", value };
  }
  return { kind: "unclear" };
}

export interface Interpretation {
  /** Mapped answer, or null if still unclear. */
  parsed: Parsed;
  /** Optional short friendly line to send before re-asking. */
  clarification: string | null;
}

const PART_GUIDE: Record<Part, string> = {
  presence: 'Allowed answers: "yes" (the symptom has been present in the last month), "no", or "unknown" (the caregiver says they don\'t know).',
  severity: "Allowed answers: 1 = mild, 2 = moderate, 3 = severe (how it affects the patient), or \"unknown\".",
  frequency:
    'Allowed answers: 0 = never, 1 = rarely, 2 = sometimes, 3 = quite frequently, 4 = nearly always, or "unknown".',
  distress:
    "Allowed answers: 0 = not distressing at all, 1 = minimal, 2 = mild, 3 = moderate, 4 = severe, 5 = extreme (how much it distresses the caregiver), or \"unknown\".",
};

/**
 * Uses the LLM for a reply rules couldn't parse. Returns unclear (with an
 * optional clarification line) when the model isn't confident.
 */
export async function interpretWithLlm(
  llm: LlmConfig,
  caregiver: string,
  part: Part,
  questionText: string,
  reply: string,
): Promise<Interpretation> {
  let result: Interpretation = { parsed: { kind: "unclear" }, clarification: null };
  await generateText({
    model: llm.model,
    providerOptions: llm.providerOptions,
    headers: sessionHeaders(caregiver),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(30_000),
    toolChoice: "required",
    system: [
      "You help administer a standardized caregiver questionnaire by text message.",
      "Decide whether the caregiver's reply clearly answers the question below.",
      "Only map the reply to an answer if the caregiver clearly meant it. Never guess; uncertain means null. \"Don't know\" means unknown, never no.",
      "If it's unclear, or the caregiver asked what the question means, write ONE short, kind sentence (under 25 words): either \"Sorry, I didn't quite get that.\" or a plain-language explanation of what the question is asking. Do not repeat or reword the question itself; it will be re-sent word for word. No medical advice.",
      PART_GUIDE[part],
    ].join("\n"),
    prompt: `Question:\n${questionText}\n\nCaregiver's reply:\n${reply}`,
    tools: {
      record_interpretation: tool({
        description: "Record how the caregiver's reply maps to the allowed answers.",
        inputSchema: z.object({
          answer: z
            .union([z.enum(["yes", "no", "unknown"]), z.number().int().min(0).max(5)])
            .nullable()
            .describe('Mapped answer, "unknown", or null if unclear.'),
          clarification: z.string().nullish().describe("One short kind sentence to send before re-asking, if unclear."),
        }),
        execute: async ({ answer, clarification }) => {
          result = { parsed: toParsed(part, answer), clarification: clarification?.trim() || null };
          return { ok: true };
        },
      }),
    },
  });
  return result;
}

function toParsed(part: Part, answer: "yes" | "no" | "unknown" | number | null): Parsed {
  if (answer === null || answer === undefined) return { kind: "unclear" };
  if (answer === "unknown") return { kind: "unknown" };
  if (part === "presence") {
    if (answer === "yes") return { kind: "answer", value: 1 };
    if (answer === "no") return { kind: "answer", value: 0 };
    return { kind: "unclear" };
  }
  if (typeof answer !== "number") return { kind: "unclear" };
  const [min, max] = PART_RANGE[part];
  return answer >= min && answer <= max ? { kind: "answer", value: answer } : { kind: "unclear" };
}
