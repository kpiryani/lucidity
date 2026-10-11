// Zarit Burden Interview, items 1–12 of the 22-item form (partial).
//
// NOT the validated ZBI-12 short form (a different selection of items), so:
// - it is labeled "ZBI (items 1–12)" everywhere;
// - the raw total (0–48) is reported without burden categories, since the
//   PDF's cutoffs (0–21 / 21–40 / 41–60 / 61–88) were made for all 22 items.
// Each item: 0 Never, 1 Rarely, 2 Sometimes, 3 Quite frequently, 4 Nearly always.
// Scores are computed here, never by the LLM; it is respondent-specific (the caregiver).
// Wording is loaded from a git-ignored file (data/instruments/zbi.local.json).

import { readFile } from "node:fs/promises";
import { latestResponses, type ItemResponse } from "./types.ts";

export const ZBI_SCORING_VERSION = "zbi-items-1-12-1.0";
export const ZBI_ITEM_IDS = Array.from({ length: 12 }, (_, i) => `ZBI-${String(i + 1).padStart(2, "0")}`);
export const ZBI_MAX_TOTAL = ZBI_ITEM_IDS.length * 4;

export interface ZbiWording {
  instrument: string;
  version: string;
  notice: string;
  instructions: string;
  scale: Record<string, string>;
  items: Record<string, { question: string }>;
}

export async function loadZbiWording(path = "data/instruments/zbi.local.json"): Promise<ZbiWording | null> {
  try {
    const wording = JSON.parse(await readFile(path, "utf8")) as ZbiWording;
    const missing = ZBI_ITEM_IDS.filter((id) => !wording.items?.[id]?.question);
    if (missing.length) throw new Error(`missing wording for ${missing.join(", ")}`);
    return wording;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export interface ZbiScores {
  scoringVersion: string;
  complete: boolean;
  /** Raw 0–48 total; null unless every item was answered. */
  total: number | null;
  max: number;
  itemsAnswered: number;
  missingItemIds: string[];
}

export function scoreZbi(responses: ItemResponse[]): ZbiScores {
  const byKey = latestResponses(responses);
  let sum = 0;
  let answered = 0;
  const missing: string[] = [];
  for (const id of ZBI_ITEM_IDS) {
    const r = byKey.get(`${id}:frequency`);
    if (r?.status === "valid" && r.value !== null) {
      sum += r.value;
      answered += 1;
    } else {
      missing.push(id);
    }
  }
  const complete = missing.length === 0;
  return {
    scoringVersion: ZBI_SCORING_VERSION,
    complete,
    total: complete ? sum : null,
    max: ZBI_MAX_TOTAL,
    itemsAnswered: answered,
    missingItemIds: missing,
  };
}
