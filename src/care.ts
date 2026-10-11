// Lucidity Care: the clinician's side, over iMessage (a separate phone,
// labeled "Simulated clinician" in the demo). Plain commands, no model:
//
//   PROFILE              -> the one-page profile (Intelligence)
//   ASK 1 | ASK <text>   -> draft a question for the caregiver
//   RECOMMEND <text>     -> draft a recommendation for the caregiver
//   APPROVE / EDIT <text> / CANCEL
//   STATUS / HELP
//
// Nothing reaches the caregiver until the clinician approves the exact text.
// Approved messages are delivered by Connect, and the caregiver's reply is
// saved (as caregiver-reported, not verified) and forwarded to the clinician.

import { compileProfile, suggestedQuestions } from "./profile.ts";
import type { CareMessage, Store } from "./store.ts";

export interface CareDeps {
  store: Store;
  /** The clinician's handle (phone/email). */
  clinician: string;
  /** Sends a text to anyone (caregiver or clinician); throws on failure. */
  send: (to: string, text: string) => Promise<void>;
  /** Which caregiver the clinician is working with (one patient per caregiver). */
  currentCaregiver: () => string | undefined;
  now?: () => Date;
}

const nowIso = (deps: { now?: () => Date }) => (deps.now?.() ?? new Date()).toISOString();
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const CLINICIAN_HELP = [
  "Lucidity Care (Simulated clinician). Commands:",
  "PROFILE: the patient's one-page profile",
  "ASK 1: send suggested question 1 (ASK <text> for your own)",
  "RECOMMEND <text>: send a recommendation",
  "APPROVE / EDIT <text> / CANCEL: for the drafted message",
  "STATUS: recent messages and replies",
].join("\n");

/** The exact text the caregiver will receive. */
export function caregiverFacing(store: Store, m: CareMessage): string {
  const who = store.caregiver(m.caregiver).patientLabel ?? "your loved one";
  return m.type === "question"
    ? `Question from ${who}'s care team: ${m.text}\n\nReply anytime, or SKIP.`
    : `From ${who}'s care team: ${m.text}`;
}

function preview(store: Store, m: CareMessage): string {
  return `Draft ${m.type} for the caregiver:\n\n"${caregiverFacing(store, m)}"\n\nReply APPROVE to send, EDIT <new text>, or CANCEL.`;
}

/** Handles one message from the clinician; returns replies to the clinician. */
export async function handleClinicianMessage(deps: CareDeps, raw: string): Promise<string[]> {
  const text = raw.trim();
  const [first = "", ...rest] = text.split(/\s+/);
  const command = first.toUpperCase().replace(/[^A-Z?]/g, "");
  const arg = rest.join(" ").trim();
  const { store } = deps;
  const caregiver = deps.currentCaregiver();
  const draft = store.careMessage(store.careDraftId);

  if (command === "HELP" || command === "?") return [CLINICIAN_HELP];

  if (command === "APPROVE") {
    if (!draft || draft.status !== "draft") return ["There's no draft to approve. Use ASK or RECOMMEND first."];
    return [await approve(deps, draft)];
  }
  if (command === "EDIT") {
    if (!draft || draft.status !== "draft") return ["There's no draft to edit."];
    if (!arg) return ["Add the new text after EDIT, e.g. EDIT Dim the lights tonight."];
    draft.text = arg;
    await store.commit();
    return [preview(store, draft)];
  }
  if (command === "CANCEL") {
    if (!draft || draft.status !== "draft") return ["There's no draft to cancel."];
    draft.status = "cancelled";
    await store.setCareDraft(undefined);
    return ["Draft cancelled. Nothing was sent."];
  }

  if (!caregiver) return ["No caregiver has texted Lucidity yet, so there's no profile."];

  if (command === "PROFILE") return [compileProfile(store, caregiver, deps.now?.())];

  if (command === "STATUS") {
    const recent = store.careMessagesFor(caregiver).filter((m) => m.status !== "draft").slice(-3);
    if (!recent.length) return ["No messages sent to the caregiver yet."];
    return [
      recent
        .map((m) => {
          const reply = m.reply ? `Reply: "${short(m.reply.text)}"` : m.status === "sent" ? "No reply yet." : "";
          return `• ${m.type} (${m.status}${m.sentAt ? ` ${clock(m.sentAt)}` : ""}): "${short(m.text)}"\n  ${reply}`;
        })
        .join("\n"),
    ];
  }

  if (command === "ASK" || command === "RECOMMEND" || command === "REC") {
    if (!arg) return [command === "ASK" ? "Add a question or a number, e.g. ASK 1." : "Add the message, e.g. RECOMMEND Dim the lights tonight."];
    let body = arg;
    if (command === "ASK" && /^\d+$/.test(arg)) {
      const picked = suggestedQuestions(store, caregiver, deps.now?.())[Number(arg) - 1];
      if (!picked) return ["That number isn't in the suggested questions. Reply PROFILE to see them."];
      body = picked.text;
    }
    if (draft?.status === "draft") draft.status = "cancelled"; // one draft at a time
    const m = await store.addCareMessage({ caregiver, type: command === "ASK" ? "question" : "recommendation", text: body });
    await store.setCareDraft(m.id);
    return [preview(store, m)];
  }

  return ["I didn't recognize that. Reply HELP for commands."];
}

async function approve(deps: CareDeps, m: CareMessage): Promise<string> {
  const { store } = deps;
  const state = store.caregiver(m.caregiver);
  await store.setCareDraft(undefined);
  m.approvedAt = nowIso(deps);
  if (state.optedOut) {
    m.status = "not_sent_opted_out";
    await store.commit();
    return "Not sent: the caregiver has opted out (STOP). They'll need to text START first.";
  }
  const out = caregiverFacing(store, m);
  try {
    await deps.send(m.caregiver, out);
  } catch (err) {
    m.status = "failed";
    await store.commit();
    console.error("[lucidity.care] delivery failed", err);
    return "Sending failed. Try APPROVE again with a new draft in a moment.";
  }
  m.status = "sent";
  m.sentAt = nowIso(deps);
  state.awaitingCareReplyFor = m.id;
  await store.appendTurn(m.caregiver, "assistant", out);
  return `Sent to the caregiver at ${clock(m.sentAt)}. I'll forward their reply here.`;
}

// ---------------------------------------------------------------- caregiver replies

const ACK_YES = /^(y|yes|yeah|yep|sure|ok|okay|will do|i'll try|ill try|sounds good)[.!]*$/i;
const ACK_SKIP = /^(skip|no|nope|no thanks|not now|pass)[.!]*$/i;

export interface CareReplyResult {
  /** Fully handled here (don't send to the AI). */
  handled: boolean;
  /** Messages to send to the caregiver when handled. */
  toCaregiver: string[];
  /** Context for the AI when not handled. */
  aiNote?: string;
}

/**
 * If the caregiver is answering a care-team message, saves the reply and
 * forwards it to the clinician. Short YES/SKIP answers are acknowledged here;
 * anything longer goes on to the AI with a note.
 */
export async function captureCareReply(deps: CareDeps, caregiver: string, text: string): Promise<CareReplyResult | null> {
  const { store } = deps;
  const state = store.caregiver(caregiver);
  const m = store.careMessage(state.awaitingCareReplyFor);
  if (!m) return null;
  state.awaitingCareReplyFor = undefined;
  m.reply = { text: text.trim(), at: nowIso(deps) };
  await store.commit();

  await notifyClinician(deps, `Caregiver replied to your ${m.type} ("${short(m.text, 60)}"):\n"${m.reply.text}"\n(Caregiver-reported.)`);

  const who = state.patientLabel ?? "your loved one";
  const isYes = ACK_YES.test(text.trim());
  const isSkip = ACK_SKIP.test(text.trim());
  if (isYes || isSkip) {
    const ack =
      m.type === "recommendation"
        ? isYes
          ? `Thank you. I've let ${who}'s care team know you'll try it.`
          : `No problem. I've let ${who}'s care team know.`
        : `No problem. I've let ${who}'s care team know.`;
    await store.appendTurn(caregiver, "user", text);
    await store.appendTurn(caregiver, "assistant", ack);
    return { handled: true, toCaregiver: [ack] };
  }
  return {
    handled: false,
    toCaregiver: [],
    aiNote: `The caregiver's message is a reply to this ${m.type} from the care team: "${m.text}". It has already been forwarded to the care team. Record anything it reports as usual, briefly thank them, and say it was shared with the care team. Don't add advice of your own.`,
  };
}

/** Sends a note to the clinician; never throws. */
export async function notifyClinician(deps: CareDeps, text: string): Promise<boolean> {
  try {
    await deps.send(deps.clinician, text);
    return true;
  } catch (err) {
    console.error("[lucidity.care] couldn't notify clinician", err);
    return false;
  }
}

/** "New update" nudge to the clinician, at most once an hour per caregiver. */
export async function nudgeClinician(deps: CareDeps, caregiver: string, what: string, force = false): Promise<void> {
  const state = deps.store.caregiver(caregiver);
  const now = deps.now?.() ?? new Date();
  if (!force && state.lastClinicianNudgeAt && now.getTime() - Date.parse(state.lastClinicianNudgeAt) < 3_600_000) return;
  state.lastClinicianNudgeAt = now.toISOString();
  await deps.store.commit();
  const name = state.patientName ?? state.patientLabel ?? "the patient";
  await notifyClinician(deps, `New update for ${name}: ${what}. Reply PROFILE to review.`);
}
