// Shared types for standardized questionnaires administered over iMessage.

export type InstrumentCode = "NPI-Q" | "ZBI";

/** One prompt within an item. NPI-Q: presence -> severity -> distress. ZBI: frequency. */
export type Part = "presence" | "severity" | "distress" | "frequency";

export type AnswerStatus = "valid" | "unknown" | "skipped" | "not_asked";

export interface ItemResponse {
  itemId: string;
  part: Part;
  /** The exact text sent to the caregiver for this prompt. */
  questionText: string;
  /** The caregiver's raw reply (null when not asked). */
  rawReply: string | null;
  /** Numeric answer; null when not valid. presence: 1 yes / 0 no. */
  value: number | null;
  status: AnswerStatus;
  /** How the reply was interpreted: deterministic parse, LLM, or system. */
  interpretedBy: "rule" | "llm" | "system";
  recordedAt: string;
}

/** Allowed numeric range per part. */
export const PART_RANGE: Record<Part, [number, number]> = {
  presence: [0, 1],
  severity: [1, 3],
  distress: [0, 5],
  frequency: [0, 4],
};

/** Latest response per (item, part); later answers supersede earlier ones. */
export function latestResponses(responses: ItemResponse[]): Map<string, ItemResponse> {
  const map = new Map<string, ItemResponse>();
  for (const r of responses) map.set(`${r.itemId}:${r.part}`, r);
  return map;
}
