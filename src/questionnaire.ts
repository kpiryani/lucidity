// Questionnaire mode: deterministic, verbatim administration of standardized
// questionnaires (NPI-Q, ZBI items 1–12). The AI conversation hands off here
// after the caregiver accepts an offer; this code asks one prompt at a time
// using the exact wording, stores each answer with the text that was shown,
// scores in code, then hands back to the AI.
//
// Functions return the messages to send; index.ts does the sending.

import { randomUUID } from "node:crypto";
import type { Interpretation } from "./answers.ts";
import { parseAnswer, type Parsed } from "./answers.ts";
import { INSTRUMENTS, availableInstruments, type Instrument, type Wordings } from "./instruments/index.ts";
import type { InstrumentCode, ItemResponse, Part } from "./instruments/types.ts";
import { DEFAULT_TIMEZONE, cadence, formatLocal, localDayAt } from "./reminders.ts";
import type { Assessment, CaregiverState, Reminder, Store } from "./store.ts";

/** After a declined offer, wait this long before offering it again. */
export const OFFER_DECLINE_COOLDOWN_DAYS = 7;
/** NPI-Q cue: different symptom domains reported in the past 7 days. */
export const CUE_MIN_DOMAINS = 2;
/** ZBI cue: caregiver-distress rating at or above this on any recent observation. */
export const CUE_HIGH_DISTRESS = 4;
const MAX_UNCLEAR = 2;
/** When a caregiver sends a rating to a YES/NO question (doesn't count as unclear). */
export const PRESENCE_NUMBER_NUDGE = "This one is YES or NO first. If YES, I'll ask how severe it is next.";

export interface QuestionnaireDeps {
  store: Store;
  wordings: Wordings;
  /** LLM fallback for replies rules can't parse (optional). */
  interpret?: (part: Part, questionText: string, reply: string) => Promise<Interpretation>;
  now?: () => Date;
  /** Caregiver time zone for check-in reminders (default America/New_York). */
  timeZone?: string;
}

/** Local hour for recurring check-in reminders. */
export const CHECKIN_REMINDER_HOUR = 18;

const DAY_MS = 86_400_000;
const isoNow = (deps: { now?: () => Date }) => (deps.now?.() ?? new Date()).toISOString();

const PAUSE = /^(pause|stop check ?-?in|later|not now|pause check ?-?in)$/i;
const RESUME = /^(resume|continue|resume check ?-?in|keep going)$/i;
const YES = /^(y|yes|yeah|yea|yep|yup|sure|ok|okay|sounds good|let's do it|lets do it|yes please)[.!]*$/i;
const NO = /^(n|no|nope|nah|no thanks|not now|maybe later|later)[.!]*$/i;

const clean = (text: string) => text.trim().replace(/[‘’]/g, "'");
const instrumentOf = (a: Assessment): Instrument => INSTRUMENTS[a.instrument];

// ---------------------------------------------------------------- offering

export type Eligibility = { ok: true } | { ok: false; reason: string };

export function eligibility(store: Store, caregiver: string, code: InstrumentCode, now = new Date()): Eligibility {
  const instrument = INSTRUMENTS[code];
  const state = store.caregiver(caregiver);
  const active = store.assessment(state.activeAssessmentId);
  if (active) {
    return {
      ok: false,
      reason: `A check-in is already ${active.status === "paused" ? "paused (they can reply RESUME)" : "in progress"}.`,
    };
  }
  const last = store.latestAssessment(caregiver, code);
  if (last?.completedAt && now.getTime() - Date.parse(last.completedAt) < instrument.repeatDays * DAY_MS) {
    return {
      ok: false,
      reason: `The ${instrument.name} was already done on ${last.completedAt.slice(0, 10)}; don't offer it again yet.`,
    };
  }
  const declined = state.declinedOffers?.[code];
  if (declined && now.getTime() - Date.parse(declined) < OFFER_DECLINE_COOLDOWN_DAYS * DAY_MS) {
    return { ok: false, reason: `The caregiver declined it on ${declined.slice(0, 10)}; don't offer again yet.` };
  }
  return { ok: true };
}

/** @deprecated use eligibility(store, caregiver, "NPI-Q") */
export const npiqEligibility = (store: Store, caregiver: string, now = new Date()) =>
  eligibility(store, caregiver, "NPI-Q", now);

/** Records an offer so the caregiver's next YES/NO is routed here. */
export async function recordOffer(
  store: Store,
  caregiver: string,
  patientLabel: string,
  now = new Date(),
  code: InstrumentCode = "NPI-Q",
): Promise<Eligibility> {
  const result = eligibility(store, caregiver, code, now);
  if (!result.ok) return result;
  const state = store.caregiver(caregiver);
  state.patientLabel = patientLabel;
  state.pendingOffer = { instrument: code, patientLabel, offeredAt: now.toISOString() };
  state.lastOfferedAt = now.toISOString();
  await store.commit();
  return result;
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

  if (YES.test(text) && deps.wordings[offer.instrument]) return start(deps, caregiver, offer.instrument, offer.patientLabel);
  if (NO.test(text)) {
    state.declinedOffers = { ...state.declinedOffers, [offer.instrument]: isoNow(deps) };
    await deps.store.commit();
    return ["No problem at all. We can do it another time."];
  }
  await deps.store.commit();
  return null;
}

// ---------------------------------------------------------------- cues

/** NPI-Q cue: 2+ different symptom domains reported in the past 7 days. */
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

/** ZBI cue: the caregiver described their own stress, or rated distress 4+, in the past 7 days. */
export function stressCueMet(store: Store, caregiver: string, now = new Date()): boolean {
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const recent = (at: string) => Date.parse(at) >= weekAgo;
  const stressNote = store
    .recentNotes(caregiver, 24 * 7)
    .some((n) => n.topic === "caregiver_wellbeing" && recent(n.reportedAt));
  const highDistress = store
    .recentRecords(caregiver, 24 * 7, 100)
    .some((r) => r.kind === "npi_observation" && recent(r.reportedAt) && (r.distress ?? 0) >= CUE_HIGH_DISTRESS);
  return stressNote || highDistress;
}

const CUES: Record<InstrumentCode, { met: typeof cueMet; why: string }> = {
  "NPI-Q": { met: cueMet, why: "several different behavior changes reported this week" },
  ZBI: { met: stressCueMet, why: "the caregiver has described their own stress or strain" },
};

/** The instrument whose cue is met and that can be offered now, if any. */
export function cuedInstrument(store: Store, caregiver: string, wordings: Wordings, now = new Date()): Instrument | null {
  const state = store.caregiver(caregiver);
  if (state.pendingOffer || (state.lastOfferedAt && now.getTime() - Date.parse(state.lastOfferedAt) < DAY_MS)) return null;
  // ZBI first: a caregiver who says they're struggling should be asked about themselves.
  for (const instrument of [INSTRUMENTS.ZBI, INSTRUMENTS["NPI-Q"]]) {
    if (!wordings[instrument.code]) continue;
    if (eligibility(store, caregiver, instrument.code, now).ok && CUES[instrument.code].met(store, caregiver, now)) {
      return instrument;
    }
  }
  return null;
}

// ---------------------------------------------------------------- session

export function promptText(wordings: Wordings, assessment: Assessment): string {
  return instrumentOf(assessment).prompt(wordings, assessment.cursor.itemIndex, assessment.cursor.part);
}

export async function start(
  deps: QuestionnaireDeps,
  caregiver: string,
  code: InstrumentCode,
  patientLabel: string,
): Promise<string[]> {
  const instrument = INSTRUMENTS[code];
  const wording = deps.wordings[code];
  if (!wording) throw new Error(`${code} wording not loaded`);
  const at = isoNow(deps);
  const assessment = await deps.store.addAssessment({
    id: `asmt_${randomUUID().slice(0, 8)}`,
    kind: "assessment",
    instrument: code,
    instrumentVersion: wording.version,
    administrationMode: "imessage_verbatim",
    recallPeriod: instrument.recallPeriod,
    respondent: caregiver,
    respondentRole: "caregiver",
    patientLabel,
    status: "in_progress",
    startedAt: at,
    updatedAt: at,
    completedAt: null,
    responses: [],
    cursor: { itemIndex: 0, part: instrument.firstPart },
    retries: 0,
    scores: null,
    source: "caregiver_imessage",
  });
  const state = deps.store.caregiver(caregiver);
  state.activeAssessmentId = assessment.id;
  state.patientLabel = patientLabel;
  await deps.store.commit();
  return [instrument.intro(deps.wordings, patientLabel), promptText(deps.wordings, assessment)];
}

/** Starts the NPI-Q (kept for tests and callers that only use the NPI-Q). */
export const startNpiq = (deps: QuestionnaireDeps, caregiver: string, patientLabel: string) =>
  start(deps, caregiver, "NPI-Q", patientLabel);

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
  return ["Welcome back. Picking up where we left off.", promptText(deps.wordings, a)];
}

function record(
  deps: QuestionnaireDeps,
  a: Assessment,
  part: Part,
  questionText: string,
  rawReply: string | null,
  value: number | null,
  status: ItemResponse["status"],
  interpretedBy: ItemResponse["interpretedBy"],
) {
  a.responses.push({
    itemId: instrumentOf(a).itemIds[a.cursor.itemIndex]!,
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
function advance(deps: QuestionnaireDeps, a: Assessment, last: ItemResponse): boolean {
  const instrument = instrumentOf(a);
  a.retries = 0;
  const next = instrument.nextPart(a.cursor.part, last.value, last.status);
  if (next) {
    a.cursor.part = next;
    return false;
  }
  for (const part of instrument.skippedParts(a.cursor.part)) {
    record(deps, a, part, "", null, null, "not_asked", "system");
  }
  a.cursor = { itemIndex: a.cursor.itemIndex + 1, part: instrument.firstPart };
  return a.cursor.itemIndex >= instrument.itemIds.length;
}

function describe(part: Part, parsed: Parsed): string {
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
  const questionText = promptText(deps.wordings, a);
  if (part === "presence" && /^\d+$/.test(text)) {
    return [`${PRESENCE_NUMBER_NUDGE}\n\n${questionText}`];
  }
  let parsed = parseAnswer(part, text);
  let interpretedBy: ItemResponse["interpretedBy"] = "rule";
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
  switch (parsed.kind) {
    case "answer":
      record(deps, a, part, questionText, text, parsed.value, "valid", interpretedBy);
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

  const done = advance(deps, a, a.responses[a.responses.length - 1]!);
  a.updatedAt = isoNow(deps);
  if (!done) {
    await deps.store.commit();
    messages.push(promptText(deps.wordings, a));
    return [messages.join("\n\n")];
  }
  return [...(messages.length ? [messages.join("\n\n")] : []), ...(await finish(deps, caregiver, a))];
}

async function finish(deps: QuestionnaireDeps, caregiver: string, a: Assessment): Promise<string[]> {
  const instrument = instrumentOf(a);
  const firstTime = !deps.store
    .snapshot()
    .assessments.some((x) => x.id !== a.id && x.respondent === caregiver && x.instrument === a.instrument && x.completedAt);
  a.scores = instrument.score(a.responses);
  a.status = instrument.isComplete(a.scores) ? "completed" : "incomplete";
  a.completedAt = isoNow(deps);
  const state = deps.store.caregiver(caregiver);
  state.activeAssessmentId = undefined;
  // Leave a short marker in the chat history so the AI knows it happened.
  await deps.store.appendTurn(
    caregiver,
    "assistant",
    `[Lucidity completed a ${instrument.name} check-in with the caregiver (${a.status}). Results are saved for the care team.]`,
  );

  const messages = [instrument.thanks(a.patientLabel)];
  // First time: offer a recurring reminder to retake it (asked once per instrument).
  const hasReminder = deps.store.activeReminders(caregiver).some((r) => r.checkIn?.instrument === a.instrument);
  if (firstTime && !state.checkInReminderAsked?.[a.instrument] && !hasReminder) {
    state.checkInReminderPrompt = { instrument: a.instrument, patientLabel: a.patientLabel, status: "queued" };
  }
  if (state.scoreConsent === undefined) {
    state.awaitingScoreConsentFor = a.id;
    messages.push("Would you like to see your results, now and after future check-ins? Reply YES or NO.");
  } else {
    if (state.scoreConsent) messages.push(resultsSummary(deps.wordings, a));
    askQueuedReminder(deps, caregiver, messages);
  }
  await deps.store.commit();
  return messages;
}

// ---------------------------------------------------------------- recurring check-in reminders

const tz = (deps: QuestionnaireDeps) => deps.timeZone ?? DEFAULT_TIMEZONE;

/** First reminder: `repeatDays` after today, at 6:00 PM local. */
export function firstCheckInDue(deps: QuestionnaireDeps, code: InstrumentCode): Date {
  return localDayAt(deps.now?.() ?? new Date(), INSTRUMENTS[code].repeatDays, CHECKIN_REMINDER_HOUR, 0, tz(deps));
}

/** Appends the recurring-reminder question if one is queued. */
function askQueuedReminder(deps: QuestionnaireDeps, caregiver: string, messages: string[]): void {
  const state = deps.store.caregiver(caregiver);
  const prompt = state.checkInReminderPrompt;
  if (prompt?.status !== "queued") return;
  const instrument = INSTRUMENTS[prompt.instrument];
  const due = firstCheckInDue(deps, prompt.instrument);
  prompt.status = "asked";
  state.checkInReminderAsked = { ...state.checkInReminderAsked, [prompt.instrument]: isoNow(deps) };
  messages.push(
    `One more thing: this check-in is most useful when it's repeated ${cadence(instrument.repeatDays)}. Want me to remind you? I'd text you on ${formatLocal(due, tz(deps))}, then ${cadence(instrument.repeatDays)}. Reply YES or NO.`,
  );
}

/** Handles YES/NO to the recurring-reminder question; null if not a clear answer. */
export async function handleCheckInReminderReply(deps: QuestionnaireDeps, caregiver: string, reply: string): Promise<string[] | null> {
  const state = deps.store.caregiver(caregiver);
  const prompt = state.checkInReminderPrompt;
  if (prompt?.status !== "asked") return null;
  const text = clean(reply);
  state.checkInReminderPrompt = undefined;
  if (YES.test(text)) {
    const instrument = INSTRUMENTS[prompt.instrument];
    const due = firstCheckInDue(deps, prompt.instrument);
    await deps.store.addReminder({
      caregiver,
      what: `${prompt.patientLabel}'s ${instrument.name} check-in`,
      dueAt: due.toISOString(),
      timeZone: tz(deps),
      repeat: "interval",
      intervalDays: instrument.repeatDays,
      checkIn: { instrument: prompt.instrument, patientLabel: prompt.patientLabel },
      quote: text,
    });
    return [
      `Done. I'll remind you ${cadence(instrument.repeatDays)}, starting ${formatLocal(due, tz(deps))}. You can ask me to change the time or cancel it anytime.`,
    ];
  }
  await deps.store.commit();
  if (NO.test(text)) return ["No problem. You can ask me for a reminder anytime."];
  return null;
}

/**
 * Text for a due check-in reminder: an invitation that records an offer so
 * YES starts it. null skips this occurrence (e.g. they already did it early).
 * undefined means it's not a check-in reminder (use the default text).
 */
export async function checkInReminderText(
  store: Store,
  wordings: Wordings,
  r: Reminder,
  now: Date,
): Promise<string | null | undefined> {
  if (!r.checkIn) return undefined;
  const { instrument: code, patientLabel } = r.checkIn;
  const instrument = INSTRUMENTS[code];
  if (!wordings[code]) return `Reminder: it's time for ${patientLabel}'s ${instrument.name} check-in.`;
  if (paused(store, r.caregiver)) return "Reminder: you have a check-in paused. Reply RESUME whenever you're ready.";
  if (inProgress(store, r.caregiver)) return null;
  const e = eligibility(store, r.caregiver, code, now);
  if (!e.ok) return null; // done recently, or declined recently
  await recordOffer(store, r.caregiver, patientLabel, now, code);
  return `Reminder: it's time for ${patientLabel}'s ${instrument.name} check-in (12 short questions, about 5 minutes). Want to do it now? Reply YES or NO.`;
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
    const messages = [resultsSummary(deps.wordings, a)];
    askQueuedReminder(deps, caregiver, messages);
    await deps.store.commit();
    return messages;
  }
  if (NO.test(text)) {
    state.scoreConsent = false;
    const messages = ["Okay, I won't show results. They'll still be shared with the care team."];
    askQueuedReminder(deps, caregiver, messages);
    await deps.store.commit();
    return messages;
  }
  await deps.store.commit();
  return null;
}

export function resultsSummary(wordings: Wordings, a: Assessment): string {
  const instrument = instrumentOf(a);
  return instrument.summary(wordings, a.patientLabel, a.scores ?? instrument.score(a.responses));
}

/** Check-in status for the AI's context (scores only if the caregiver consented). */
export function assessmentContext(
  store: Store,
  caregiver: string,
  state: CaregiverState,
  now: Date,
  wordings: Wordings,
): string {
  const lines: string[] = [];
  const active = store.assessment(state.activeAssessmentId);
  if (active?.status === "paused") {
    lines.push(`- A ${INSTRUMENTS[active.instrument].name} check-in is paused. The caregiver can reply RESUME to continue.`);
  }
  const instruments = availableInstruments(wordings);
  for (const instrument of instruments) {
    const last = store.latestAssessment(caregiver, instrument.code);
    if (!last?.completedAt) continue;
    const detail =
      state.scoreConsent && last.scores
        ? `, ${instrument.contextResult(last.scores)}`
        : " (results not shared with the caregiver)";
    lines.push(`- Last ${instrument.name}: ${last.completedAt.slice(0, 10)} (${last.status}${detail}).`);
  }

  const cued = cuedInstrument(store, caregiver, wordings, now);
  if (state.pendingOffer || (state.lastOfferedAt && now.getTime() - Date.parse(state.lastOfferedAt) < DAY_MS)) {
    lines.push("- A check-in was already offered today; don't offer another.");
  } else if (cued) {
    lines.push(
      `- CUE MET for the ${cued.name} (${CUES[cued.code].why}). Offer it in this reply: call offer_questionnaire with instrument "${cued.code}" and invite them, unless the caregiver is raising a safety concern.`,
    );
  }
  for (const instrument of instruments) {
    const e = eligibility(store, caregiver, instrument.code, now);
    lines.push(
      e.ok
        ? `- ${instrument.code} (${instrument.name}, about ${instrument.about}): may be offered if a cue fits.`
        : `- ${instrument.code}: do not offer. ${e.reason}`,
    );
  }
  return lines.join("\n");
}
