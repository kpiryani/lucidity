import { Spectrum, type Message, type Space } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { runAgent } from "./agent.ts";
import { captureCareReply, handleClinicianMessage, nudgeClinician, type CareDeps } from "./care.ts";
import { draftCareMessage } from "./drafting.ts";
import { isGreetingOnly, welcomeMessages } from "./welcome.ts";
import { Debouncer } from "./debounce.ts";
import { interpretWithLlm } from "./answers.ts";
import type { Wordings } from "./instruments/index.ts";
import { loadNpiqWording } from "./instruments/npiq.ts";
import { loadZbiWording } from "./instruments/zbi.ts";
import { loadLlmConfig } from "./llm.ts";
import {
  checkInReminderText,
  handleCheckInReminderReply,
  handleOfferReply,
  handleQuestionnaireReply,
  handleScoreConsent,
  inProgress,
  isResume,
  pause,
  paused,
  resume,
  type QuestionnaireDeps,
} from "./questionnaire.ts";
import { Store, type Alert } from "./store.ts";
import { DEFAULT_TIMEZONE, isValidTimeZone, startReminderLoop } from "./reminders.ts";
import { AI_ESCALATION_FOLLOWUP, AI_ESCALATION_REPLY, triage, triageReply } from "./triage.ts";
// Spectrum bridges a single agent loop to many messaging interfaces.
// Each provider in `providers` adds an interface (terminal TUI, iMessage, …).
// Docs: https://photon.codes/docs/spectrum-ts
const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [
    // imessage
    imessage.config(),
  ],
});

// Optional on-call care-team number (E.164, e.g. +15551234567). On Free/Pro
// shared lines it must be registered as a project user in the Photon
// dashboard, or proactive sends fail with "Target not allowed".
const CARE_TEAM_PHONE = process.env.CARE_TEAM_PHONE?.trim() || undefined;

// The clinician's phone (Lucidity Care, "Simulated clinician" in the demo).
// Messages from this number are clinician commands, never caregiver messages.
const CLINICIAN_PHONE = process.env.CLINICIAN_PHONE?.trim() || undefined;
// Safety alerts go to the care-team phone, else the clinician.
const ALERT_PHONE = CARE_TEAM_PHONE ?? CLINICIAN_PHONE;

// How long to wait for a caregiver to stop typing before replying.
const BURST_WINDOW_MS = Number(process.env.BURST_WINDOW_MS ?? 10000);

const store = new Store(process.env.LUCIDITY_DATA_FILE?.trim() || "data/lucidity.json");
await store.load();

// The AI is optional: without LLM_* variables the bot keeps Phase 1 behavior.
const llm = loadLlmConfig();
console.log(
  llm
    ? `[lucidity] AI enabled: model "${llm.modelId}" at ${llm.baseURL} (reasoning effort: ${llm.reasoningEffort ?? "default"})`
    : "[lucidity] AI disabled (set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL in .env). Using Phase 1 replies.",
);

const AI_FAILURE_REPLY =
  "Sorry, I'm having trouble replying right now. Your message is saved, and you can keep texting. If anything is urgent, call 911 or your doctor.";

// Reminders are sent in this time zone unless a caregiver has their own.
const envTimeZone = process.env.LUCIDITY_TIMEZONE?.trim();
const TIMEZONE = envTimeZone && isValidTimeZone(envTimeZone) ? envTimeZone : DEFAULT_TIMEZONE;
if (envTimeZone && TIMEZONE !== envTimeZone) console.warn(`[lucidity] Unknown LUCIDITY_TIMEZONE "${envTimeZone}"; using ${TIMEZONE}.`);

// Latest conversation per caregiver, reused for reminders (falls back to
// opening the DM through Spectrum, e.g. after a restart).
const spaces = new Map<string, Space>();

async function sendTo(caregiver: string, text: string): Promise<void> {
  let space = spaces.get(caregiver);
  if (!space) {
    const im = imessage(app);
    space = await im.space.create(await im.user(caregiver));
    spaces.set(caregiver, space);
  }
  await space.send(text);
}


// Verbatim questionnaire wording lives in git-ignored local files.
const wordings: Wordings = { "NPI-Q": await loadNpiqWording(), ZBI: await loadZbiWording() };
const enabled = (Object.keys(wordings) as Array<keyof Wordings>).filter((k) => wordings[k]);
console.log(
  enabled.length
    ? `[lucidity] Check-ins enabled: ${enabled.join(", ")}.`
    : "[lucidity] Check-ins disabled (no data/instruments/*.local.json found).",
);

function questionnaireDeps(from: string): QuestionnaireDeps | null {
  if (!enabled.length) return null;
  return {
    store,
    wordings,
    timeZone: TIMEZONE,
    interpret: llm ? (part, questionText, reply) => interpretWithLlm(llm, from, part, questionText, reply) : undefined,
  };
}

const stopReminders = startReminderLoop({
  store,
  send: sendTo,
  compose: (reminder, now) => checkInReminderText(store, wordings, reminder, now),
  log: (message, data) => console.log(message, data === undefined ? "" : JSON.stringify(data)),
});
console.log(`[lucidity] Reminders running (time zone: ${TIMEZONE}).`);
process.once("beforeExit", stopReminders);

const careDeps: CareDeps | null = CLINICIAN_PHONE
  ? {
      store,
      clinician: CLINICIAN_PHONE,
      send: sendTo,
      // One patient per caregiver; the clinician works with the most recently
      // active caregiver (or DEMO_CAREGIVER_PHONE if set).
      currentCaregiver: () =>
        process.env.DEMO_CAREGIVER_PHONE?.trim() ||
        store.caregiversByActivity().find((c) => c.address !== CLINICIAN_PHONE)?.address,
      // Intelligence drafts caregiver-friendly wording; the clinician approves it.
      draft: llm ? (input) => draftCareMessage(llm, input) : undefined,
    }
  : null;
console.log(
  careDeps
    ? "[lucidity] Care enabled: clinician commands from CLINICIAN_PHONE."
    : "[lucidity] Care disabled (set CLINICIAN_PHONE in .env).",
);

async function sendAll(space: Space, messages: string[]): Promise<void> {
  for (const m of messages) await space.send(m);
}

/**
 * Routes a message to questionnaire mode when a check-in, offer, or results
 * question is pending. Returns true if it was handled here (not by the AI).
 */
async function routeQuestionnaire(space: Space, from: string, text: string): Promise<boolean> {
  const q = questionnaireDeps(from);
  if (!q) return false;
  const state = store.caregiver(from);

  const active = inProgress(store, from);
  if (active) {
    await space.responding(async () => sendAll(space, await handleQuestionnaireReply(q, from, text)));
    if (active.completedAt && careDeps) {
      await nudgeClinician(careDeps, from, `${active.instrument} check-in completed (${active.status})`, true);
    }
    return true;
  }
  if (paused(store, from) && isResume(text)) {
    await sendAll(space, (await resume(q, from)) ?? []);
    return true;
  }
  if (state.awaitingScoreConsentFor) {
    const messages = await handleScoreConsent(q, from, text);
    if (messages) {
      await sendAll(space, messages);
      return true;
    }
  }
  if (state.checkInReminderPrompt?.status === "asked") {
    const messages = await handleCheckInReminderReply(q, from, text);
    if (messages) {
      await sendAll(space, messages);
      return true;
    }
  }
  if (state.pendingOffer) {
    const messages = await handleOfferReply(q, from, text);
    if (messages) {
      await space.responding(async () => sendAll(space, messages));
      return true;
    }
  }
  return false;
}

const STOP_WORDS = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;
// RESUME is reserved for resuming a paused check-in.
const START_WORDS = /^(start|unstop)$/i;

// Until the dashboard exists, alerts are stored, logged, and, if configured,
// texted to the care team. Returns whether a human was actually notified.
async function alertCareTeam(input: Omit<Alert, "id" | "at">): Promise<boolean> {
  const alert = await store.addAlert(input);
  console.warn("[lucidity.alert]", JSON.stringify(alert));

  if (!ALERT_PHONE) return false;
  try {
    const state = store.caregiver(input.caregiver);
    const name = state.patientName ?? state.patientLabel ?? "a patient";
    const at = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE });
    await sendTo(
      ALERT_PHONE,
      `⚠ Lucidity ${input.level.toUpperCase()} alert for ${name} (${input.source === "rules" ? "fixed safety rules" : "AI flag"}: ${input.reasons.join(", ")}).\nCaregiver wrote: "${input.text}"\nFixed safety guidance was sent to the caregiver at ${at}.`,
    );
    return true;
  } catch (err) {
    console.error("[lucidity.alert] failed to text care team", err);
    return false;
  }
}

// Phase 1 behavior, used when the AI is off or fails.
async function acknowledge(space: Space, message: Message): Promise<void> {
  await message.react("👍");
  await space.send("Thanks, I've noted that.");
}

interface Inbound {
  space: Space;
  message: Message;
  text: string;
  safetyReply: string | null; // set when the rules already answered this text
  careNote?: string; // set when this text replies to a care-team message
}

// One turn at a time per caregiver, so a slow model call can't interleave.
const turnChains = new Map<string, Promise<void>>();

async function handleTurn(from: string, items: Inbound[]): Promise<void> {
  const last = items[items.length - 1]!;
  const { space, message } = last;
  const text = items.map((i) => i.text).join("\n");
  const safetyReplies = items.flatMap((i) => (i.safetyReply ? [i.safetyReply] : []));
  const safetyHandled = safetyReplies.length > 0;
  const careNotes = items.flatMap((i) => (i.careNote ? [i.careNote] : []));

  const recordTurn = async (assistantText: string | null) => {
    await store.appendTurn(from, "user", text);
    for (const reply of safetyReplies) await store.appendTurn(from, "assistant", reply);
    if (assistantText) await store.appendTurn(from, "assistant", assistantText);
  };

  if (!llm) {
    if (!safetyHandled) await acknowledge(space, message);
    await recordTurn(null);
    return;
  }

  // When the rules already replied, the model only records in the background,
  // so don't show a typing bubble for a reply that will never come.
  const withTyping = (work: () => Promise<void>) => (safetyHandled ? work() : space.responding(work));

  await withTyping(async () => {
    try {
      const result = await runAgent(
        {
          store,
          llm,
          wordings,
          defaultTimeZone: TIMEZONE,
          onStep: (step) => console.log("[lucidity.step]", JSON.stringify(step)),
          onEscalate: async (caregiver, reason, quote) => {
            if (safetyHandled) return false; // rules already sent guidance for this turn
            store.caregiver(caregiver).lastEmergencyAt = new Date().toISOString();
            await space.send(AI_ESCALATION_REPLY);
            const notified = await alertCareTeam({
              caregiver,
              level: "urgent",
              source: "ai",
              reasons: [reason],
              text: quote,
            });
            if (notified) await space.send("I've also alerted your care team.");
            return notified;
          },
        },
        from,
        text,
        {
          note:
            [
              safetyHandled
                ? "Lucidity already sent this caregiver fixed safety guidance for this message. Still record what they reported, but do not repeat safety instructions; your reply will not be sent."
                : "",
              ...careNotes,
            ]
              .filter(Boolean)
              .join("\n\n") || undefined,
        },
      );
      console.log("[lucidity.agent]", JSON.stringify({ from, tools: result.toolCalls, escalated: result.escalated }));
      if (careDeps && result.toolCalls.includes("log_npi_observation")) {
        await nudgeClinician(careDeps, from, "the caregiver reported a behavior change");
      }

      // When the rules already replied, the model only records; its text is dropped.
      // Safety wording is never generated: when the rules replied, the model only
      // records; when the AI escalated, it gets a fixed supportive line instead of
      // its own text (which could contain medical advice).
      const reply = safetyHandled ? null : result.escalated ? AI_ESCALATION_FOLLOWUP : result.reply;
      if (reply) await space.send(reply);
      else if (!safetyHandled && !result.escalated) await message.react("👍");
      await recordTurn(reply);
    } catch (err) {
      console.error("[lucidity.agent] failed", { from, err });
      // Don't claim anything was recorded; only the message itself was saved.
      if (!safetyHandled) await space.send(AI_FAILURE_REPLY);
      await recordTurn(null);
    }
  });
}

const batcher = new Debouncer<Inbound>(BURST_WINDOW_MS, (from, items) => {
  const next = (turnChains.get(from) ?? Promise.resolve())
    .then(() => handleTurn(from, items))
    .catch((err) => console.error("[lucidity] turn failed", { from, err }));
  turnChains.set(from, next);
  return next;
});

// `app.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of app.messages) {
  // Skip our own sends echoed back through the stream.
  if (message.direction === "outbound") continue;
  if (message.content.type !== "text") continue;

  const from = message.sender?.id ?? "unknown";
  const text = message.content.text;
  spaces.set(from, space);

  // Clinician commands (Lucidity Care) never go through caregiver handling.
  if (careDeps && from === CLINICIAN_PHONE) {
    try {
      // Typing bubble while Lucidity drafts wording for the clinician.
      await space.responding(async () => sendAll(space, await handleClinicianMessage(careDeps, text)));
    } catch (err) {
      console.error("[lucidity.care] failed to handle clinician message", err);
    }
    continue;
  }

  try {
    // Safety triage runs first, on every message, with no batching delay and
    // before any LLM. It also applies to caregivers who have opted out.
    const result = triage(text);
    let safetyReply: string | null = null;
    if (result) {
      // Tell the caregiver what to do before anything else can fail.
      safetyReply = triageReply(result);
      await space.send(safetyReply);
      const notified = await alertCareTeam({
        caregiver: from,
        level: result.level,
        source: "rules",
        reasons: result.matches.map((m) => m.category),
        text,
      });
      if (notified) await space.send("I've also alerted your care team.");
      // An emergency interrupts any check-in, drops offers, and holds
      // routine reminders for a while (docs/CONTEXT.md, Safety rules).
      store.caregiver(from).pendingOffer = undefined;
      store.caregiver(from).lastEmergencyAt = new Date().toISOString();
      await store.commit();
      if (await pause(store, from)) {
        await space.send("I've paused your check-in. Reply RESUME whenever you're ready.");
      }
    }

    // STOP / START are handled by code, never by the model.
    if (STOP_WORDS.test(text.trim())) {
      await pause(store, from);
      store.caregiver(from).pendingOffer = undefined;
      await store.setOptedOut(from, true);
      await space.send(
        "You're unsubscribed and won't get reminders or check-ins from Lucidity. Text START anytime to come back. In an emergency, call 911.",
      );
      continue;
    }
    if (START_WORDS.test(text.trim())) {
      await store.setOptedOut(from, false);
      const held = store.activeReminders(from).length;
      await space.send(
        `Welcome back. Tell me anything you've noticed, whenever it's convenient.${held ? " Your reminders are back on." : ""}`,
      );
      continue;
    }
    if (store.caregiver(from).optedOut) {
      if (!result) await space.send("You're currently unsubscribed. Text START if you'd like to talk with Lucidity again.");
      continue;
    }

    // First-time welcome (fixed, warm). Emergencies come first; the welcome
    // waits for a calmer message.
    const caregiverState = store.caregiver(from);
    if (!result && !caregiverState.welcomedAt && caregiverState.history.length === 0) {
      caregiverState.welcomedAt = new Date().toISOString();
      const welcome = await space.responding(async () => {
        const messages = await welcomeMessages(llm, from);
        await sendAll(space, messages);
        return messages;
      });
      await store.appendTurn(from, "user", text);
      for (const m of welcome) await store.appendTurn(from, "assistant", m);
      if (isGreetingOnly(text)) continue;
    }

    // Check-in answers are handled immediately by code, not batched for the AI.
    if (!result && (await routeQuestionnaire(space, from, text))) continue;

    // A reply to a care-team question or recommendation is saved and forwarded.
    let careNote: string | undefined;
    if (!result && careDeps) {
      const reply = await captureCareReply(careDeps, from, text);
      if (reply?.handled) {
        await sendAll(space, reply.toCaregiver);
        continue;
      }
      careNote = reply?.aiNote;
    }

    batcher.push(from, { space, message, text, safetyReply, careNote });
  } catch (err) {
    console.error("[lucidity] failed to handle message", { from, err });
  }
}
