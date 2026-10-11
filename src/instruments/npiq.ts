// NPI-Q structure and scoring. No copyrighted wording lives in this public
// repo: question text is loaded at runtime from a git-ignored file
// (data/instruments/npiq.local.json; template in docs/instruments/).
//
// Scoring follows the NPI-Q form (Kaufer et al., 2000):
// - Each of 12 domains: present Yes/No for the last month.
// - No  -> severity 0, distress 0 (computed values, domain absent).
// - Yes -> severity 1–3 and caregiver distress 0–5 are required.
// - Totals: severity 0–36 and distress 0–60, reported separately.
// - Unknown/skipped answers stay missing; incomplete forms get no totals.
// Scores are computed here, never by the LLM.

import { readFile } from "node:fs/promises";
import type { NpiDomain } from "../store.ts";

export const NPIQ_SCORING_VERSION = "npiq-1.0";

export const NPIQ_ITEMS = [
  { id: "NPIQ-01", domain: "delusions" },
  { id: "NPIQ-02", domain: "hallucinations" },
  { id: "NPIQ-03", domain: "agitation_aggression" },
  { id: "NPIQ-04", domain: "depression_dysphoria" },
  { id: "NPIQ-05", domain: "anxiety" },
  { id: "NPIQ-06", domain: "elation_euphoria" },
  { id: "NPIQ-07", domain: "apathy_indifference" },
  { id: "NPIQ-08", domain: "disinhibition" },
  { id: "NPIQ-09", domain: "irritability_lability" },
  { id: "NPIQ-10", domain: "aberrant_motor_behavior" },
  { id: "NPIQ-11", domain: "nighttime_behaviors" },
  { id: "NPIQ-12", domain: "appetite_eating" },
] as const satisfies ReadonlyArray<{ id: string; domain: NpiDomain }>;

export type NpiqItemId = (typeof NPIQ_ITEMS)[number]["id"];
export type NpiqPart = "presence" | "severity" | "distress";

export interface NpiqWording {
  instrument: string;
  version: string;
  notice: string;
  instructions: string;
  severityPrompt: string;
  severityOptions: Record<string, string>;
  distressPrompt: string;
  distressOptions: Record<string, string>;
  items: Record<NpiqItemId, { label: string; question: string }>;
}

/** Loads the verbatim wording, or null if the local file isn't present. */
export async function loadNpiqWording(path = "data/instruments/npiq.local.json"): Promise<NpiqWording | null> {
  try {
    const wording = JSON.parse(await readFile(path, "utf8")) as NpiqWording;
    const missing = NPIQ_ITEMS.filter((item) => !wording.items?.[item.id]?.question);
    if (missing.length) throw new Error(`missing wording for ${missing.map((m) => m.id).join(", ")}`);
    return wording;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export type AnswerStatus = "valid" | "unknown" | "skipped" | "not_asked";

export interface NpiqResponse {
  itemId: NpiqItemId;
  part: NpiqPart;
  /** The exact text sent to the caregiver for this prompt. */
  questionText: string;
  /** The caregiver's raw reply (null when not asked). */
  rawReply: string | null;
  /** presence: 1 = yes, 0 = no. severity: 1–3. distress: 0–5. null when not valid. */
  value: number | null;
  status: AnswerStatus;
  /** How the reply was interpreted: deterministic parse or LLM. */
  interpretedBy: "rule" | "llm" | "system";
  recordedAt: string;
}

export interface NpiqScores {
  scoringVersion: string;
  complete: boolean;
  /** null unless complete — incomplete forms never get fabricated totals. */
  severityTotal: number | null;
  distressTotal: number | null;
  symptomsPresent: number;
  /** Domain-level results for answered items. */
  domains: Array<{ itemId: NpiqItemId; present: boolean | null; severity: number | null; distress: number | null }>;
  missingItemIds: NpiqItemId[];
}

/** Latest response per (item, part); later answers supersede earlier ones. */
function latest(responses: NpiqResponse[]): Map<string, NpiqResponse> {
  const map = new Map<string, NpiqResponse>();
  for (const r of responses) map.set(`${r.itemId}:${r.part}`, r);
  return map;
}

export function scoreNpiq(responses: NpiqResponse[]): NpiqScores {
  const byKey = latest(responses);
  const domains: NpiqScores["domains"] = [];
  const missing: NpiqItemId[] = [];

  for (const { id } of NPIQ_ITEMS) {
    const presence = byKey.get(`${id}:presence`);
    if (!presence || presence.status !== "valid") {
      domains.push({ itemId: id, present: null, severity: null, distress: null });
      missing.push(id);
      continue;
    }
    if (presence.value === 0) {
      domains.push({ itemId: id, present: false, severity: 0, distress: 0 });
      continue;
    }
    const severity = byKey.get(`${id}:severity`);
    const distress = byKey.get(`${id}:distress`);
    const sev = severity?.status === "valid" ? severity.value : null;
    const dis = distress?.status === "valid" ? distress.value : null;
    domains.push({ itemId: id, present: true, severity: sev, distress: dis });
    if (sev === null || dis === null) missing.push(id);
  }

  const complete = missing.length === 0;
  const sum = (key: "severity" | "distress") => domains.reduce((acc, d) => acc + (d[key] ?? 0), 0);
  return {
    scoringVersion: NPIQ_SCORING_VERSION,
    complete,
    severityTotal: complete ? sum("severity") : null,
    distressTotal: complete ? sum("distress") : null,
    symptomsPresent: domains.filter((d) => d.present === true).length,
    domains,
    missingItemIds: missing,
  };
}
