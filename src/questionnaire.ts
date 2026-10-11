// Questionnaire mode: deterministic, verbatim administration of the NPI-Q.
// The AI conversation hands off here (after the caregiver accepts an offer);
// this code asks one prompt at a time using the exact wording, stores each
// answer with the text that was shown, scores in code, then hands back.
//
// Functions return the messages to send; index.ts does the sending.

import { randomUUID } from "node:crypto";
import type { Interpretation } from "./answers.ts";
import { parseAnswer, type Parsed } from "./answers.ts";
import {
  NPIQ_ITEMS,
  scoreNpiq,
  type NpiqPart,
  type NpiqResponse,
  type NpiqWording,
} from "./instruments/npiq.ts";
import type { Assessment, CaregiverState, Store } from "./store.ts";

/** Don't offer the NPI-Q again within its one-month recall period. */
export const NPIQ_REPEAT_DAYS = 28;
/** After a declined offer, wait this long before offering again. */
export const OFFER_DECLINE_COOLDOWN_DAYS = 7;
const MAX_UNCLEAR = 2;

export interface QuestionnaireDeps {
  store: Store;
  wording: NpiqWording;
  /** LLM fallback for replies rules can't parse (optional). */
  interpret?: (part: NpiqPart, questionText: string, reply: string) => Promise<Interpretation>;
  now?: () => Date;
}

const DAY_MS = 86_400_000;
const isoNow = (deps: { now?: () => Date }) => (deps.now?.() ?? new Date()).toISOString();

const PAUSE = /^(pause|stop check ?-?in|later|not now|pause check ?-?in)$/i;
const RESUME = /^(resume|continue|resume check ?-?in|keep going)$/i;
const YES = /^(y|yes|yeah|yea|yep|yup|sure|ok|okay|sounds good|let's do it|lets do it|yes please)[.!]*$/i;
const NO = /^(n|no|nope|nah|no thanks|not now|maybe later|later)[.!]*$/i;

const clean = (text: string) => text.trim().replace(/[‘’]/g, "'");

// ---------------------------------------------------------------- offering

export type Eligibility = { ok: true } | { ok: false; reason: string };

export function npiqEligibility(store: Store, caregiver: string, now = new Date()): Eligibility {
  const state = store.caregiver(caregiver);
  const active = store.assessment(state.activeAssessmentId);
  if (active) {
    return { ok: false, reason: `A check-in is already ${active.status === "paused" ? "paused (they can reply RESUME)" : "in progress"}.` };
  }
  const last = store.latestAssessment(caregiver, "NPI-Q");
  if (last?.completedAt && now.getTime() - Date.parse(last.completedAt) < NPIQ_REPEAT_DAYS * DAY_MS) {
    return { ok: false, reason: `The NPI-Q was already done on ${last.completedAt.slice(0, 10)}; it covers the past month, so don't offer it again yet.` };
  }
  const declined = state.declinedOffers?.["NPI-Q"];
  if (declined && now.getTime() - Date.parse(declined) < OFFER_DECLINE_COOLDOWN_DAYS * DAY_MS) {
    return { ok: false, reason: `The caregiver declined the check-in on ${declined.slice(0, 10)}; don't offer again yet.` };
  }
  return { ok: true };
}

/** Records an offer so the caregiver's next YES/NO is routed here. */
export async function recordOffer(store: Store, caregiver: string, patientLabel: string, now = new Date()): Promise<Eligibility> {
  const eligibility = npiqEligibility(store, caregiver, now);
  if (!eligibility.ok) return eligibility;
  const state = store.caregiver(caregiver);
  state.patientLabel = patientLabel;
  state.pendingOffer = { instrument: "NPI-Q", patientLabel, offeredAt: now.toISOString() };
  state.lastOfferedAt = now.toISOString();
  await store.commit();
  return eligibility;
}

/**
 * Handles a reply while an offer is pending. Returns messages to send, or
 * null when the reply isn't a clear yes/no (the offer is dropped and the
 * message goes to the AI conversation instead).
 */
export async function handleOfferReply(deps: QuestionnaireDeps, caregiver: string, reply: string): Promise<string[] | null> {
  const state = deps.store.caregiver(caregiver);
  const offer = state.pendingOffer;
  if (!offer) return null;
  const text = clean(reply);
  state.pendingOffer = undefined;

  if (YES.test(text)) return startNpiq(deps, caregiver, offer.patientLabel);
  if (NO.test(text)) {
    state.declinedOffers = { ...state.declinedOffers, "NPI-Q": isoNow(deps) };
    await deps.store.commit();
    return ["No problem at all. We can do it another time."];
  }
  await deps.store.commit();
  return null;
}

// ---------------------------------------------------------------- prompts

function currentItem(assessment: Assessment) {
  return NPIQ_ITEMS[assessment.cursor.itemIndex]!;
}

export function promptText(wording: NpiqWording, assessment: Assessment): string {
  const { itemIndex, part } = assessment.cursor;
  const item = currentItem(assessment);
  const { label, question } = wording.items[item.id];
  if (part === "presence") {
    return `${itemIndex + 1}/${NPIQ_ITEMS.length} — ${label}\n${question}\n\nReply YES or NO.`;
  }
  const [prompt, options, reply] =
    part === "severity"
      ? [wording.severityPrompt, wording.severityOptions, "Reply 1, 2, or 3."]
      : [wording.distressPrompt, wording.distressOptions, "Reply a number from 0 to 5."];
  const lines = Object.entries(options).map(([k, v]) => `${k} = ${v}`);
  return `${label}: ${prompt}\n${lines.join("\n")}\n\n${reply}`;
}

function intro(wording: NpiqWording, patientLabel: string): string {
  return [
    `Great, thank you. This is the NPI-Q, a standard check-in care teams use. The questions are about ${patientLabel}; where it says "the patient," that means ${patientLabel}.`,
    wording.instructions,
    `There are ${NPIQ_ITEMS.length} questions. If you answer YES, I'll also ask how severe it is and how much it distresses you.`,
    "Reply SKIP to skip a question, PAUSE anytime to pause, and RESUME to continue.",
  ].join("\n\n");
}

// ---------------------------------------------------------------- session

export async function startNpiq(deps: QuestionnaireDeps, caregiver: string, patientLabel: string): Promise<string[]> {
  const at = isoNow(deps);
  const assessment = await deps.store.addAssessment({
    id: `asmt_${randomUUID().slice(0, 8)}`,
    kind: "assessment",
    instrument: "NPI-Q",
    instrumentVersion: deps.wording.version,
    administrationMode: "imessage_verbatim",
    recallPeriod: "past month",
    respondent: caregiver,
    respondentRole: "caregiver",
    patientLabel,
    status: "in_progress",
    startedAt: at,
    updatedAt: at,
    completedAt: null,
    responses: [],
    cursor: { itemIndex: 0, part: "presence" },
    retries: 0,
    scores: null,
    source: "caregiver_imessage",
  });
  const state = deps.store.caregiver(caregiver);
  state.activeAssessmentId = assessment.id;
  state.patientLabel = patientLabel;
  await deps.store.commit();
  return [intro(deps.wording, patientLabel), promptText(deps.wording, assessment)];
}

/** The caregiver's active assessment if it's currently in progress. */
export function inProgress(store: Store, caregiver: string): Assessment | undefined {
  const a = store.assessment(store.caregiver(caregiver).activeAssessmentId);
  return a?.status === "in_progress" ? a : undefined;
}

export function paused(store: Store, caregiver: string): Assessment | undefined {
  const a = store.assessment(store.caregiver(caregiver).activeAssessmentId);
  return a?.status === "paused" ? a : undefined;
}

export const isResume = (text: string) => RESUME.test(clean(text));

export async function pause(store: Store, caregiver: string): Promise<boolean> {
  const a = inProgress(store, caregiver);
  if (!a) return false;
  a.status = "paused";
  a.updatedAt = new Date().toISOString();
  await store.commit();
  return true;
}

export async function resume(deps: QuestionnaireDeps, caregiver: string): Promise<string[] | null> {
  const a = paused(deps.store, caregiver);
  if (!a) return null;
  a.status = "in_progress";
  a.retries = 0;
  a.updatedAt = isoNow(deps);
  await deps.store.commit();
  return ["Welcome back. Picking up where we left off.", promptText(deps.wording, a)];
}

function record(
  deps: QuestionnaireDeps,
  a: Assessment,
  part: NpiqPart,
  questionText: string,
  rawReply: string | null,
  value: number | null,
  status: NpiqResponse["status"],
  interpretedBy: NpiqResponse["interpretedBy"],
) {
  a.responses.push({
    itemId: currentItem(a).id,
    part,
    questionText,
    rawReply,
    value,
    status,
    interpretedBy,
    recordedAt: isoNow(deps),
  });
}

/** Moves the cursor after the current prompt; returns true when finished. */
function advance(deps: QuestionnaireDeps, a: Assessment, presenceYes: boolean): boolean {
  a.retries = 0;
  const { part } = a.cursor;
  if (part === "presence" && presenceYes) {
    a.cursor.part = "severity";
    return false;
  }
  if (part === "severity") {
    a.cursor.part = "distress";
    return false;
  }
  if (part === "presence") {
    // Not present / unknown / skipped: severity and distress aren't asked.
    record(deps, a, "severity", "", null, null, "not_asked", "system");
    record(deps, a, "distress", "", null, null, "not_asked", "system");
  }
  a.cursor = { itemIndex: a.cursor.itemIndex + 1, part: "presence" };
  return a.cursor.itemIndex >= NPIQ_ITEMS.length;
}

function describe(part: NpiqPart, parsed: Parsed): string {
  if (parsed.kind !== "answer") return "";
  if (part === "presence") return parsed.value === 1 ? "Yes" : "No";
  return String(parsed.value);
}

/** Handles a reply while a questionnaire is in progress. */
export async function handleQuestionnaireReply(deps: QuestionnaireDeps, caregiver: string, reply: string): Promise<string[]> {
  const a = inProgress(deps.store, caregiver);
  if (!a) return [];
  const text = clean(reply);

  if (PAUSE.test(text)) {
    await pause(deps.store, caregiver);
    return ["Paused. Reply RESUME anytime to pick up where you left off."];
  }

  const part = a.cursor.part;
  const questionText = promptText(deps.wording, a);
  let parsed = parseAnswer(part, text);
  let interpretedBy: NpiqResponse["interpretedBy"] = "rule";
  let clarification: string | null = null;

  if (parsed.kind === "unclear" && deps.interpret) {
    try {
      const result = await deps.interpret(part, questionText, text);
      parsed = result.parsed;
      clarification = result.clarification;
      interpretedBy = "llm";
    } catch (err) {
      console.error("[lucidity.questionnaire] interpreter failed", err);
    }
  }

  const messages: string[] = [];
  let presenceYes = false;

  switch (parsed.kind) {
    case "answer":
      record(deps, a, part, questionText, text, parsed.value, "valid", interpretedBy);
      presenceYes = part === "presence" && parsed.value === 1;
      if (interpretedBy === "llm") messages.push(`Got it: ${describe(part, parsed)}.`);
      break;
    case "unknown":
      record(deps, a, part, questionText, text, null, "unknown", interpretedBy);
      messages.push("Okay, I'll mark that one as not sure.");
      break;
    case "skip":
      record(deps, a, part, questionText, text, null, "skipped", "rule");
      break;
    case "unclear":
      a.retries += 1;
      if (a.retries < MAX_UNCLEAR) {
        a.updatedAt = isoNow(deps);
        await deps.store.commit();
        return [`${clarification ?? "Sorry, I didn't quite get that."}\n\n${questionText}`];
      }
      record(deps, a, part, questionText, text, null, "unknown", "system");
      messages.push("No problem, I'll mark that one as not sure and move on.");
      break;
  }

  const done = advance(deps, a, presenceYes);
  a.updatedAt = isoNow(deps);
  if (!done) {
    await deps.store.commit();
    messages.push(promptText(deps.wording, a));
    return [messages.join("\n\n")];
  }
  return [...(messages.length ? [messages.join("\n\n")] : []), ...(await finish(deps, caregiver, a))];
}

async function finish(deps: QuestionnaireDeps, caregiver: string, a: Assessment): Promise<string[]> {
  a.scores = scoreNpiq(a.responses);
  a.status = a.scores.complete ? "completed" : "incomplete";
  a.completedAt = isoNow(deps);
  const state = deps.store.caregiver(caregiver);
  state.activeAssessmentId = undefined;
  // Leave a short marker in the chat history so the AI knows it happened.
  await deps.store.appendTurn(
    caregiver,
    "assistant",
    `[Lucidity completed an NPI-Q check-in with the caregiver (${a.status}). Results are saved for the care team.]`,
  );

  const messages = [
    `Thank you, that's the whole check-in. It's saved and will be shared with ${a.patientLabel}'s care team.`,
  ];
  if (state.scoreConsent === undefined) {
    state.awaitingScoreConsentFor = a.id;
    messages.push("Would you like to see your results, now and after future check-ins? Reply YES or NO.");
  } else if (state.scoreConsent) {
    messages.push(resultsSummary(deps.wording, a));
  }
  await deps.store.commit();
  return messages;
}

// ---------------------------------------------------------------- results

/** Handles the one-time "see your results?" answer; null if not a clear yes/no. */
export async function handleScoreConsent(deps: QuestionnaireDeps, caregiver: string, reply: string): Promise<string[] | null> {
  const state = deps.store.caregiver(caregiver);
  const a = deps.store.assessment(state.awaitingScoreConsentFor);
  if (!a) return null;
  const text = clean(reply);
  state.awaitingScoreConsentFor = undefined;
  if (YES.test(text)) {
    state.scoreConsent = true;
    await deps.store.commit();
    return [resultsSummary(deps.wording, a)];
  }
  if (NO.test(text)) {
    state.scoreConsent = false;
    await deps.store.commit();
    return ["Okay, I won't show results. They'll still be shared with the care team."];
  }
  await deps.store.commit();
  return null;
}

export function resultsSummary(wording: NpiqWording, a: Assessment): string {
  const scores = a.scores ?? scoreNpiq(a.responses);
  const lines = [`Your NPI-Q results for ${a.patientLabel} (past month):`];
  const present = scores.domains.filter((d) => d.present);
  if (present.length === 0) lines.push("No symptoms were reported as present.");
  for (const d of present) {
    const fmt = (v: number | null, max: number) => (v === null ? "not answered" : `${v} of ${max}`);
    lines.push(`• ${wording.items[d.itemId].label}: severity ${fmt(d.severity, 3)}, distress ${fmt(d.distress, 5)}`);
  }
  if (scores.complete) {
    lines.push(`Total severity: ${scores.severityTotal} of 36`, `Total distress: ${scores.distressTotal} of 60`);
  } else {
    lines.push("Some answers were skipped or unsure, so totals aren't calculated.");
  }
  lines.push("These are for the care team to review, not a diagnosis.");
  return lines.join("\n");
}

/** Short summary for the AI's context (scores only if the caregiver consented). */
export function assessmentContext(store: Store, caregiver: string, state: CaregiverState, now = new Date()): string {
  const lines: string[] = [];
  const active = store.assessment(state.activeAssessmentId);
  if (active?.status === "paused") lines.push("- An NPI-Q check-in is paused. The caregiver can reply RESUME to continue.");
  const last = store.latestAssessment(caregiver, "NPI-Q");
  if (last?.completedAt) {
    const scores = last.scores;
    const detail =
      state.scoreConsent && scores
        ? `, symptoms present: ${scores.symptomsPresent}${scores.complete ? `, total severity ${scores.severityTotal}/36, total distress ${scores.distressTotal}/60` : " (incomplete)"}`
        : " (results not shared with the caregiver)";
    lines.push(`- Last NPI-Q: ${last.completedAt.slice(0, 10)} (${last.status}${detail}).`);
  }
  const eligibility = npiqEligibility(store, caregiver, now);
  if (!eligibility.ok) {
    lines.push(`- NPI-Q check-in: do not offer. ${eligibility.reason}`);
  } else if (state.pendingOffer || (state.lastOfferedAt && now.getTime() - Date.parse(state.lastOfferedAt) < DAY_MS)) {
    lines.push("- NPI-Q check-in: already offered today; don't offer again.");
  } else if (cueMet(store, caregiver, now)) {
    lines.push(
      "- NPI-Q check-in: CUE MET (several different behavior changes reported this week). Offer it in this reply: call offer_questionnaire and invite them, unless the caregiver is in distress or raising a safety concern.",
    );
  } else {
    lines.push("- NPI-Q check-in: may be offered if the caregiver asks for a fuller check-in or describes an ongoing pattern.");
  }
  return lines.join("\n");
}

/** Code-level cue: 2+ different NPI-Q domains reported in the past 7 days. */
export const CUE_MIN_DOMAINS = 2;
export function cueMet(store: Store, caregiver: string, now = new Date()): boolean {
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const domains = new Set(
    store
      .recentRecords(caregiver, 24 * 7, 100)
      .filter((r) => r.kind === "npi_observation" && Date.parse(r.reportedAt) >= weekAgo)
      .map((r) => (r.kind === "npi_observation" ? r.domain : "")),
  );
  return domains.size >= CUE_MIN_DOMAINS;
}
