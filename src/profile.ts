// Lucidity Intelligence: compiles Connect's records into a one-page patient
// profile for the clinician, entirely in code (no model). Every line comes
// from a saved record; questionnaire changes compare code-computed scores;
// suggested questions come from simple, explainable rules.

import type { NpiqScores } from "./instruments/npiq.ts";
import { NPIQ_ITEMS } from "./instruments/npiq.ts";
import { ZBI_ITEM_IDS, ZBI_MAX_TOTAL, type ZbiScores } from "./instruments/zbi.ts";
import { latestResponses } from "./instruments/types.ts";
import type { Assessment, NpiDomain, NpiObservation, Store } from "./store.ts";

const DAY_MS = 86_400_000;
export const PROFILE_WINDOW_DAYS = 30;

/** Plain-language names for NPI-Q domains, for the clinician and caregiver. */
export const DOMAIN_LABELS: Record<NpiDomain, string> = {
  delusions: "false beliefs",
  hallucinations: "seeing or hearing things",
  agitation_aggression: "agitation",
  depression_dysphoria: "low mood",
  anxiety: "anxiety",
  elation_euphoria: "unusual cheerfulness",
  apathy_indifference: "loss of interest",
  disinhibition: "impulsive behavior",
  irritability_lability: "irritability",
  aberrant_motor_behavior: "pacing or wandering",
  nighttime_behaviors: "night-time waking",
  appetite_eating: "appetite changes",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

// ---------------------------------------------------------------- comparisons

export interface DomainChange {
  domain: NpiDomain;
  label: string;
  before: number | null; // severity, 0 when absent
  after: number | null;
}

/** NPI-Q severity per domain, before vs after, for domains present in either. */
export function compareNpiq(previous: Assessment, current: Assessment): DomainChange[] {
  const prev = previous.scores as NpiqScores | null;
  const curr = current.scores as NpiqScores | null;
  if (!prev || !curr) return [];
  const sev = (s: NpiqScores, itemId: string) => s.domains.find((d) => d.itemId === itemId)?.severity ?? null;
  const present = (s: NpiqScores, itemId: string) => s.domains.find((d) => d.itemId === itemId)?.present === true;
  return NPIQ_ITEMS.filter((i) => present(prev, i.id) || present(curr, i.id)).map((i) => ({
    domain: i.domain,
    label: DOMAIN_LABELS[i.domain],
    before: sev(prev, i.id),
    after: sev(curr, i.id),
  }));
}

/** ZBI: how many items rose between two administrations (both answered). */
export function zbiItemsRose(previous: Assessment, current: Assessment): { rose: number; compared: number } {
  const p = latestResponses(previous.responses);
  const c = latestResponses(current.responses);
  let rose = 0;
  let compared = 0;
  for (const id of ZBI_ITEM_IDS) {
    const a = p.get(`${id}:frequency`);
    const b = c.get(`${id}:frequency`);
    if (a?.status !== "valid" || b?.status !== "valid" || a.value === null || b.value === null) continue;
    compared += 1;
    if (b.value > a.value) rose += 1;
  }
  return { rose, compared };
}

// ---------------------------------------------------------------- suggested questions

export interface SuggestedQuestion {
  text: string;
  /** Why it's suggested (shown to the clinician). */
  because: string;
}

/** Rule-based follow-up questions from gaps and changes in the records. */
export function suggestedQuestions(store: Store, caregiver: string, now = new Date()): SuggestedQuestion[] {
  const state = store.caregiver(caregiver);
  const who = state.patientLabel ?? "your loved one";
  const out: SuggestedQuestion[] = [];
  const { observations, lucidityEpisodes } = store.recordsBetween(caregiver, new Date(now.getTime() - PROFILE_WINDOW_DAYS * DAY_MS), now);

  // 1. Biggest rise on the NPI-Q -> ask about timing (a pattern clinicians use).
  const [current, previous] = store.assessmentsFor(caregiver, "NPI-Q");
  if (current && previous) {
    const rises = compareNpiq(previous, current)
      .filter((c) => c.before !== null && c.after !== null && c.after > c.before)
      .sort((a, b) => b.after! - b.before! - (a.after! - a.before!));
    const top = rises[0];
    if (top) {
      out.push({
        text: `Does ${who}'s ${top.label} tend to happen at a particular time of day, like the evening?`,
        because: `${cap(top.label)} rose from ${top.before} to ${top.after} on the NPI-Q.`,
      });
    }
  }

  // 2. Reported symptoms with no severity yet.
  const latestByDomain = new Map<NpiDomain, NpiObservation>();
  for (const o of observations) latestByDomain.set(o.domain, o);
  for (const o of latestByDomain.values()) {
    if (out.length >= 3) break;
    if (o.severity !== null || o.followupDeclined) continue;
    out.push({
      text: `How intense has ${who}'s ${DOMAIN_LABELS[o.domain]} been lately: mild, moderate, or severe?`,
      because: `${cap(DOMAIN_LABELS[o.domain])} was reported ("${short(o.quote, 50)}") without a severity.`,
    });
  }

  // 3. A lucid moment without context.
  const episode = lucidityEpisodes.at(-1);
  if (out.length < 3 && episode && episode.context === null) {
    out.push({
      text: `When ${who} had that clear moment on ${day(episode.reportedAt)}, what was happening right before?`,
      because: "A lucid moment was reported without what preceded it.",
    });
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- profile

export function compileProfile(store: Store, caregiver: string, now = new Date()): string {
  const state = store.caregiver(caregiver);
  const name = state.patientName ?? state.patientLabel ?? "Patient";
  const from = new Date(now.getTime() - PROFILE_WINDOW_DAYS * DAY_MS);
  const records = store.recordsBetween(caregiver, from, now);
  const lines: string[] = [];
  const section = (title: string) => lines.push("", title);

  lines.push(
    `${name.toUpperCase()} — Lucidity profile`,
    `Prototype for care-team review. Caregiver refers to them as "${state.patientLabel ?? "—"}". Last ${PROFILE_WINDOW_DAYS} days.`,
  );

  // NPI-Q
  const [npiNow, npiBefore] = store.assessmentsFor(caregiver, "NPI-Q");
  section("Behavior check-in (NPI-Q)");
  if (!npiNow) {
    lines.push("No NPI-Q yet.");
  } else {
    const s = npiNow.scores as NpiqScores | null;
    const synthetic = (a: Assessment) => (a.source === "synthetic_demo" ? " (synthetic)" : "");
    if (npiBefore) {
      const p = npiBefore.scores as NpiqScores | null;
      lines.push(`Changes, ${day(npiBefore.completedAt!)}${synthetic(npiBefore)} to ${day(npiNow.completedAt!)}${synthetic(npiNow)}:`);
      for (const c of compareNpiq(npiBefore, npiNow)) {
        const change = c.before === c.after ? `${c.after ?? "?"}, no change` : `${c.before ?? "?"} to ${c.after ?? "?"}`;
        lines.push(`• ${cap(c.label)}: ${change}`);
      }
      if (p?.complete && s?.complete) {
        lines.push(
          `Total severity: ${p.severityTotal} to ${s.severityTotal} of 36. Caregiver distress: ${p.distressTotal} to ${s.distressTotal} of 60.`,
        );
      } else {
        lines.push("Totals not compared (a check-in is incomplete).");
      }
    } else if (s) {
      lines.push(`${day(npiNow.completedAt!)}${synthetic(npiNow)}: ${s.symptomsPresent} symptoms present.`);
      lines.push(s.complete ? `Total severity ${s.severityTotal}/36, caregiver distress ${s.distressTotal}/60.` : "Incomplete; no totals.");
    }
  }

  // ZBI
  const [zbiNow, zbiBefore] = store.assessmentsFor(caregiver, "ZBI");
  if (zbiNow) {
    const s = zbiNow.scores as ZbiScores | null;
    section("Caregiver strain (ZBI items 1–12, partial record)");
    if (zbiBefore) {
      const p = zbiBefore.scores as ZbiScores | null;
      const { rose, compared } = zbiItemsRose(zbiBefore, zbiNow);
      lines.push(`${rose} of ${compared} questions rose since ${day(zbiBefore.completedAt!)}.`);
      if (p?.complete && s?.complete) lines.push(`Total: ${p.total} to ${s.total} of ${ZBI_MAX_TOTAL}.`);
    } else if (s) {
      lines.push(s.complete ? `Total ${s.total} of ${ZBI_MAX_TOTAL} (${day(zbiNow.completedAt!)}).` : "Incomplete; no total.");
    }
  }

  // Caregiver's words
  if (records.observations.length) {
    section("Reported by the caregiver (their words)");
    const byDomain = new Map<NpiDomain, NpiObservation[]>();
    for (const o of records.observations) byDomain.set(o.domain, [...(byDomain.get(o.domain) ?? []), o]);
    const ranked = [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    for (const [domain, obs] of ranked) {
      const latest = obs.at(-1)!;
      const rating =
        latest.severity !== null ? ` severity ${latest.severity}/3${latest.distress !== null ? `, distress ${latest.distress}/5` : ""}` : "";
      lines.push(`• ${cap(DOMAIN_LABELS[domain])} (${obs.length}×${rating ? `,${rating}` : ""}): "${short(latest.quote)}"`);
    }
  }

  if (records.lucidityEpisodes.length) {
    section("Lucid moments");
    for (const e of records.lucidityEpisodes.slice(-2)) {
      lines.push(`• ${day(e.reportedAt)}: "${short(e.quote)}"${e.duration ? ` (${e.duration})` : ""}`);
    }
  }

  if (records.alerts.length) {
    section("Safety alerts");
    for (const a of records.alerts.slice(-3)) {
      lines.push(`• ${day(a.at)} ${a.level} (${a.source === "rules" ? "fixed rules" : "AI flag"}): "${short(a.text, 70)}"`);
    }
  }

  const questions = suggestedQuestions(store, caregiver, now);
  if (questions.length) {
    section("Suggested questions for the caregiver");
    questions.forEach((q, i) => lines.push(`${i + 1}. ${q.text}\n   Why: ${q.because}`));
  }

  lines.push("", "Reply ASK 1, ASK <your question>, RECOMMEND <message>, or HELP.");
  return lines.join("\n");
}
