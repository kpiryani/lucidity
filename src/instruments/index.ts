// Instrument registry: per-questionnaire flow, prompts, scoring and results
// text, so the questionnaire engine can administer any of them the same way.

import { NPIQ_ITEMS, scoreNpiq, type NpiqScores, type NpiqWording } from "./npiq.ts";
import type { AnswerStatus, InstrumentCode, ItemResponse, Part } from "./types.ts";
import { ZBI_ITEM_IDS, ZBI_MAX_TOTAL, scoreZbi, type ZbiScores, type ZbiWording } from "./zbi.ts";

export type Scores = NpiqScores | ZbiScores;

export interface Wordings {
  "NPI-Q"?: NpiqWording | null;
  ZBI?: ZbiWording | null;
}

export interface Instrument {
  code: InstrumentCode;
  /** Name shown to caregivers and the AI. */
  name: string;
  /** What the check-in is about, for offers. */
  about: string;
  itemIds: readonly string[];
  recallPeriod: string;
  /** Don't offer again within this many days of completing it. */
  repeatDays: number;
  firstPart: Part;
  /** The next part of the same item after an answer, or null to move on. */
  nextPart(part: Part, value: number | null, status: AnswerStatus): Part | null;
  /** Parts of the current item to mark not_asked when moving on early. */
  skippedParts(part: Part): Part[];
  intro(wordings: Wordings, patientLabel: string): string;
  prompt(wordings: Wordings, itemIndex: number, part: Part): string;
  score(responses: ItemResponse[]): Scores;
  isComplete(scores: Scores): boolean;
  thanks(patientLabel: string): string;
  /** Results text shown to the caregiver (after consent). */
  summary(wordings: Wordings, patientLabel: string, scores: Scores): string;
  /** One-line result for the AI's context (only when the caregiver consented). */
  contextResult(scores: Scores): string;
}

const CONTROLS = "Reply SKIP to skip a question, PAUSE anytime to pause, and RESUME to continue.";

const npiqWording = (w: Wordings) => {
  if (!w["NPI-Q"]) throw new Error("NPI-Q wording not loaded");
  return w["NPI-Q"];
};
const zbiWording = (w: Wordings) => {
  if (!w.ZBI) throw new Error("ZBI wording not loaded");
  return w.ZBI;
};

export const NPIQ: Instrument = {
  code: "NPI-Q",
  name: "NPI-Q",
  about: "behavior and mood changes in the patient over the past month",
  itemIds: NPIQ_ITEMS.map((i) => i.id),
  recallPeriod: "past month",
  repeatDays: 28,
  firstPart: "presence",
  nextPart(part, value, status) {
    if (part === "presence") return status === "valid" && value === 1 ? "severity" : null;
    if (part === "severity") return "distress";
    return null;
  },
  skippedParts: (part) => (part === "presence" ? ["severity", "distress"] : []),
  intro(w, patientLabel) {
    return [
      `Great, thank you. This is the NPI-Q, a standard check-in care teams use. The questions are about ${patientLabel}; where it says "the patient," that means ${patientLabel}.`,
      npiqWording(w).instructions,
      `There are ${NPIQ_ITEMS.length} questions. If you answer YES, I'll also ask how severe it is and how much it distresses you.`,
      CONTROLS,
    ].join("\n\n");
  },
  prompt(w, itemIndex, part) {
    const wording = npiqWording(w);
    const { label, question } = wording.items[NPIQ_ITEMS[itemIndex]!.id];
    if (part === "presence") return `${itemIndex + 1}/${NPIQ_ITEMS.length} — ${label}\n${question}\n\nReply YES or NO.`;
    const [prompt, options, reply] =
      part === "severity"
        ? [wording.severityPrompt, wording.severityOptions, "Reply 1, 2, or 3."]
        : [wording.distressPrompt, wording.distressOptions, "Reply a number from 0 to 5."];
    const lines = Object.entries(options).map(([k, v]) => `${k} = ${v}`);
    return `${label}: ${prompt}\n${lines.join("\n")}\n\n${reply}`;
  },
  score: scoreNpiq,
  isComplete: (s) => s.complete,
  thanks: (patientLabel) => `Thank you, that's the whole check-in. It's saved and will be shared with ${patientLabel}'s care team.`,
  summary(w, patientLabel, s) {
    const scores = s as NpiqScores;
    const wording = npiqWording(w);
    const lines = [`Your NPI-Q results for ${patientLabel} (past month):`];
    const present = scores.domains.filter((d) => d.present);
    if (present.length === 0) lines.push("No symptoms were reported as present.");
    const fmt = (v: number | null, max: number) => (v === null ? "not answered" : `${v} of ${max}`);
    for (const d of present) {
      lines.push(`• ${wording.items[d.itemId].label}: severity ${fmt(d.severity, 3)}, distress ${fmt(d.distress, 5)}`);
    }
    if (scores.complete) {
      lines.push(`Total severity: ${scores.severityTotal} of 36`, `Total distress: ${scores.distressTotal} of 60`);
    } else {
      lines.push("Some answers were skipped or unsure, so totals aren't calculated.");
    }
    lines.push("These are for the care team to review, not a diagnosis.");
    return lines.join("\n");
  },
  contextResult(s) {
    const scores = s as NpiqScores;
    return `symptoms present: ${scores.symptomsPresent}${scores.complete ? `, total severity ${scores.severityTotal}/36, total distress ${scores.distressTotal}/60` : " (incomplete)"}`;
  },
};

export const ZBI: Instrument = {
  code: "ZBI",
  name: "ZBI (items 1–12)",
  about: "how caring for the patient has been affecting the caregiver",
  itemIds: ZBI_ITEM_IDS,
  recallPeriod: "current",
  repeatDays: 14,
  firstPart: "frequency",
  nextPart: () => null,
  skippedParts: () => [],
  intro(w, patientLabel) {
    const wording = zbiWording(w);
    const scale = Object.entries(wording.scale)
      .map(([k, v]) => `${k} = ${v}`)
      .join(", ");
    return [
      `Thank you. This is a short caregiver check-in from the Zarit Burden Interview (the first 12 questions). It's about you and how caring for ${patientLabel} has been for you; "your relative" means ${patientLabel}. There are no right or wrong answers.`,
      wording.instructions,
      `For each question, reply a number: ${scale}.`,
      CONTROLS,
    ].join("\n\n");
  },
  prompt(w, itemIndex) {
    const wording = zbiWording(w);
    const id = ZBI_ITEM_IDS[itemIndex]!;
    const scale = Object.entries(wording.scale)
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n");
    return `${itemIndex + 1}/${ZBI_ITEM_IDS.length}\n${wording.items[id]!.question}\n\n${scale}\n\nReply 0 to 4.`;
  },
  score: scoreZbi,
  isComplete: (s) => s.complete,
  thanks: (patientLabel) =>
    `Thank you for sharing how you've been feeling. It's saved and will be shared with ${patientLabel}'s care team.`,
  summary(_w, _patientLabel, s) {
    const scores = s as ZbiScores;
    const lines = ["Your caregiver check-in results (Zarit Burden Interview, first 12 questions):"];
    lines.push(
      scores.complete
        ? `Total: ${scores.total} of ${ZBI_MAX_TOTAL} (higher means more strain).`
        : "Some answers were skipped or unsure, so the total isn't calculated.",
    );
    lines.push(
      "This shorter version doesn't have official score categories; your care team will review it.",
      "If you'd like support in the meantime, the Alzheimer's Association 24/7 Helpline is 1-800-272-3900.",
    );
    return lines.join("\n");
  },
  contextResult(s) {
    const scores = s as ZbiScores;
    return scores.complete ? `total ${scores.total}/${ZBI_MAX_TOTAL}` : "incomplete";
  },
};

export const INSTRUMENTS: Record<InstrumentCode, Instrument> = { "NPI-Q": NPIQ, ZBI };

export function availableInstruments(wordings: Wordings): Instrument[] {
  return Object.values(INSTRUMENTS).filter((i) => !!wordings[i.code]);
}
