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
  "Lucidity Care (Simulated clinician). You can type naturally, e.g.:",
  "• \"profile\" or \"how is he doing?\": the one-page profile",
  "• \"ask 1\": send suggested question 1",
  "• \"ask them: Does it start after dinner?\": your own question",
  "• \"tell them: Dim the lights tonight.\": a recommendation",
  "• \"send it\" / \"looks good\": approve the draft",
  "• \"change it to …\": edit the draft",
  "• \"never mind\": cancel the draft",
  "• \"any replies?\": what was sent and how they replied",
].join("\n");

export type ClinicianCommand = "HELP" | "PROFILE" | "STATUS" | "APPROVE" | "EDIT" | "CANCEL" | "ASK" | "RECOMMEND" | "UNKNOWN";

// Natural phrasings for each command. The message text after a prefix keeps
// the clinician's original wording and capitalization.
const BODY_PREFIXES: Array<[ClinicianCommand, RegExp]> = [
  ["EDIT", /^(?:edit|change (?:it|that|the draft) to|change to|make it|reword (?:it )?(?:to|as)|instead(?:,)? say|actually(?:,)? say|say instead)\s*:?\s+([\s\S]+)$/i],
  [
    "ASK",
    /^(?:ask(?: them| the caregiver| caregiver| the family)?|send (?:a )?question|question)\s*:?\s+([\s\S]+)$/i,
  ],
  [
    "RECOMMEND",
    /^(?:recommend(?:ation)?|rec|suggest(?:ion)?|advise|tell(?: them| the caregiver| caregiver| the family)?|send (?:a )?(?:recommendation|message)|let them know)\s*:?\s+([\s\S]+)$/i,
  ],
];
const EXACT: Array<[ClinicianCommand, RegExp]> = [
  ["HELP", /^(help|\?|commands|menu|what can i do|options)$/i],
  [
    "PROFILE",
    /^(profile|show (?:me )?(?:the )?profile|summary|report|overview|chart|show (?:me )?(?:the )?(?:summary|report|chart)|update|what'?s new|how(?:'s| is) (?:he|she|they|the patient|[a-z]+) doing)$/i,
  ],
  ["STATUS", /^(status|any replies|replies|what did they say|did they reply|history|sent)$/i],
  [
    "APPROVE",
    /^(approve|approved|send|send it|send that|yes|y|yep|yeah|looks good|lgtm|ok|okay|ok send|go ahead|confirm|sounds good|good to go|perfect)$/i,
  ],
  ["CANCEL", /^(cancel|never ?mind|don'?t send(?: it)?|do not send|scrap (?:it|that)|discard|delete (?:it|that|the draft)|no|nope|no thanks)$/i],
];

/** Maps a clinician's text to a command and its message body. */
export function parseClinicianCommand(raw: string): { command: ClinicianCommand; arg: string } {
  const text = raw
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^(?:please|pls|can you|could you)\s+/i, "");
  // "ask 1", "send 1", "use #2", "question 3"
  const numbered = /^(?:ask|send|use|question)?\s*#?\s*(\d)$/i.exec(text);
  if (numbered) return { command: "ASK", arg: numbered[1]! };
  for (const [command, re] of BODY_PREFIXES) {
    const m = re.exec(text);
    if (m) return { command, arg: m[1]!.trim() };
  }
  const bare = text.replace(/[.!?]+$/, "").trim();
  for (const [command, re] of EXACT) if (re.test(bare) || (command === "HELP" && text === "?")) return { command, arg: "" };
  return { command: "UNKNOWN", arg: "" };
}

/** Capitalizes the first letter of a drafted message. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The exact text the caregiver will receive. */
export function caregiverFacing(store: Store, m: CareMessage): string {
  const who = store.caregiver(m.caregiver).patientLabel ?? "your loved one";
  return m.type === "question"
    ? `Question from ${who}'s care team: ${m.text}\n\nReply anytime, or SKIP.`
    : `From ${who}'s care team: ${m.text}`;
}

function preview(store: Store, m: CareMessage): string {
  return `Draft ${m.type} for the caregiver:\n\n"${caregiverFacing(store, m)}"\n\nSay "send it" to approve, "change it to …" to edit, or "never mind" to cancel.`;
}

/** Handles one message from the clinician; returns replies to the clinician. */
export async function handleClinicianMessage(deps: CareDeps, raw: string): Promise<string[]> {
  const { command, arg } = parseClinicianCommand(raw);
  const { store } = deps;
  const caregiver = deps.currentCaregiver();
  const draft = store.careMessage(store.careDraftId);

  if (command === "HELP") return [CLINICIAN_HELP];

  if (command === "APPROVE") {
    if (!draft || draft.status !== "draft") {
      return ['There\'s nothing to send yet. Try "ask 1" or "tell them: <message>" first.'];
    }
    return [await approve(deps, draft)];
  }
  if (command === "EDIT") {
    if (!draft || draft.status !== "draft") return ["There's no draft to edit."];
    if (!arg) return ['Add the new text, e.g. "change it to: Dim the lights tonight."'];
    draft.text = sentence(arg);
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

  if (command === "ASK" || command === "RECOMMEND") {
    if (!arg) return [command === "ASK" ? 'Add a question or a number, e.g. "ask 1".' : 'Add the message, e.g. "tell them: Dim the lights tonight."'];
    let body = sentence(arg);
    if (command === "ASK" && /^\d+$/.test(arg)) {
      const picked = suggestedQuestions(store, caregiver, deps.now?.())[Number(arg) - 1];
      if (!picked) return ['That number isn\'t in the suggested questions. Say "profile" to see them.'];
      body = picked.text;
    }
    if (draft?.status === "draft") draft.status = "cancelled"; // one draft at a time
    const m = await store.addCareMessage({ caregiver, type: command === "ASK" ? "question" : "recommendation", text: body });
    await store.setCareDraft(m.id);
    return [preview(store, m)];
  }

  return ['I didn\'t catch that. Say "help" to see what you can ask, e.g. "profile", "ask 1", or "tell them: …".'];
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
  await notifyClinician(deps, `New update for ${name}: ${what}. Reply "profile" to review.`);
}
