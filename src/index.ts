import { Spectrum, type Message, type Space } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { runAgent } from "./agent.ts";
import { Debouncer } from "./debounce.ts";
import { loadLlmConfig } from "./llm.ts";
import { Store, type Alert } from "./store.ts";
import { AI_ESCALATION_REPLY, triage, triageReply } from "./triage.ts";
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

const STOP_WORDS = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;
const START_WORDS = /^(start|unstop|resume)$/i;

// Until the dashboard exists, alerts are stored, logged, and, if configured,
// texted to the care team. Returns whether a human was actually notified.
async function alertCareTeam(input: Omit<Alert, "id" | "at">): Promise<boolean> {
  const alert = await store.addAlert(input);
  console.warn("[lucidity.alert]", JSON.stringify(alert));

  if (!CARE_TEAM_PHONE) return false;
  try {
    const im = imessage(app);
    const space = await im.space.create(await im.user(CARE_TEAM_PHONE));
    await space.send(
      `Lucidity ${input.level.toUpperCase()} alert (${input.reasons.join(", ")}) from caregiver ${input.caregiver}:\n\n"${input.text}"`,
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
}

// One turn at a time per caregiver, so a slow model call can't interleave.
const turnChains = new Map<string, Promise<void>>();

async function handleTurn(from: string, items: Inbound[]): Promise<void> {
  const last = items[items.length - 1]!;
  const { space, message } = last;
  const text = items.map((i) => i.text).join("\n");
  const safetyReplies = items.flatMap((i) => (i.safetyReply ? [i.safetyReply] : []));
  const safetyHandled = safetyReplies.length > 0;

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
          onStep: (step) => console.log("[lucidity.step]", JSON.stringify(step)),
          onEscalate: async (caregiver, reason, quote) => {
            if (safetyHandled) return false; // rules already sent guidance for this turn
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
          note: safetyHandled
            ? "Lucidity already sent this caregiver fixed safety guidance for this message. Still record what they reported, but do not repeat safety instructions; your reply will not be sent."
            : undefined,
        },
      );
      console.log("[lucidity.agent]", JSON.stringify({ from, tools: result.toolCalls, escalated: result.escalated }));

      // When the rules already replied, the model only records; its text is dropped.
      const reply = safetyHandled ? null : result.reply;
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
    }

    // STOP / START are handled by code, never by the model.
    if (STOP_WORDS.test(text.trim())) {
      await store.setOptedOut(from, true);
      await space.send(
        "You're unsubscribed and won't get check-ins from Lucidity. Text START anytime to come back. In an emergency, call 911.",
      );
      continue;
    }
    if (START_WORDS.test(text.trim())) {
      await store.setOptedOut(from, false);
      await space.send("Welcome back. Tell me anything you've noticed, whenever it's convenient.");
      continue;
    }
    if (store.caregiver(from).optedOut) {
      if (!result) await space.send("You're currently unsubscribed. Text START if you'd like to talk with Lucidity again.");
      continue;
    }

    batcher.push(from, { space, message, text, safetyReply });
  } catch (err) {
    console.error("[lucidity] failed to handle message", { from, err });
  }
}
