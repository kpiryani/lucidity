import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { REMINDER_CLARIFY_REPLY, claimsReminder, runAgent } from "./agent.ts";
import {
  EMERGENCY_HOLD_MS,
  addLocalDays,
  deliverDue,
  describeReminder,
  formatLocal,
  cadence,
  rescheduledDue,
  resolveDue,
  zonedToUtc,
} from "./reminders.ts";
import { Store } from "./store.ts";

const TZ = "America/New_York";
const C = "+15550000001";
// Sun Oct 11 2026, 3:00 PM in New York (EDT, UTC-4).
const NOW = new Date("2026-10-11T19:00:00Z");

// --- time zones -------------------------------------------------------------

test("local wall-clock time converts to the right instant, including across DST", () => {
  assert.equal(zonedToUtc({ year: 2026, month: 10, day: 11, hour: 20, minute: 0 }, TZ).toISOString(), "2026-10-12T00:00:00.000Z");
  // Nov 2 2026 is after DST ends (EST, UTC-5).
  assert.equal(zonedToUtc({ year: 2026, month: 11, day: 2, hour: 20, minute: 0 }, TZ).toISOString(), "2026-11-03T01:00:00.000Z");
  // Daily repeat keeps 8:00 PM local across the DST change.
  const before = new Date("2026-10-31T00:00:00Z"); // Oct 30, 8 PM EDT
  const after = addLocalDays(before, 3, TZ); // Nov 2, 8 PM EST
  assert.equal(after.toISOString(), "2026-11-03T01:00:00.000Z");
});

test("8pm today when still ahead, tomorrow when already passed", () => {
  const tonight = resolveDue("20:00", null, TZ, NOW);
  assert.ok(tonight.ok && formatLocal(tonight.dueAt, TZ) === "Sun, Oct 11 at 8:00 PM");
  const morning = resolveDue("09:30", null, TZ, NOW);
  assert.ok(morning.ok && formatLocal(morning.dueAt, TZ) === "Mon, Oct 12 at 9:30 AM");
});

test("explicit dates; bad or past times are rejected", () => {
  const r = resolveDue("14:00", "2026-10-15", TZ, NOW);
  assert.ok(r.ok && formatLocal(r.dueAt, TZ) === "Thu, Oct 15 at 2:00 PM");
  assert.equal(resolveDue("8pm", null, TZ, NOW).ok, false);
  assert.equal(resolveDue("25:00", null, TZ, NOW).ok, false);
  assert.equal(resolveDue("09:00", "2026-10-11", TZ, NOW).ok, false); // already passed
});

// --- delivery ---------------------------------------------------------------

async function withReminder(store: Store, overrides: Partial<Parameters<Store["addReminder"]>[0]> = {}) {
  return store.addReminder({
    caregiver: C,
    what: "give Dad his meds",
    dueAt: "2026-10-12T00:00:00.000Z", // 8 PM EDT
    timeZone: TZ,
    repeat: "none",
    quote: "remind me at 8pm",
    ...overrides,
  });
}

function sender() {
  const sent: string[] = [];
  return { sent, send: async (_c: string, text: string) => void sent.push(text) };
}

test("a one-time reminder is sent once when due, then marked sent", async () => {
  const store = new Store(null);
  const r = await withReminder(store);
  const { sent, send } = sender();
  assert.equal(await deliverDue({ store, send, now: () => new Date("2026-10-11T23:59:00Z") }), 0);
  assert.equal(await deliverDue({ store, send, now: () => new Date("2026-10-12T00:00:10Z") }), 1);
  assert.deepEqual(sent, ["Reminder: give Dad his meds"]);
  assert.equal(r.status, "sent");
  assert.equal(await deliverDue({ store, send, now: () => new Date("2026-10-12T00:01:00Z") }), 0);
  assert.match(store.recentHistory(C).at(-1)!.text, /Reminder: give Dad his meds/);
});

test("a daily reminder moves to the same local time tomorrow", async () => {
  const store = new Store(null);
  const r = await withReminder(store, { repeat: "daily" });
  const { send } = sender();
  await deliverDue({ store, send, now: () => new Date("2026-10-12T00:00:10Z") });
  assert.equal(r.status, "scheduled");
  assert.equal(formatLocal(new Date(r.dueAt), TZ), "Mon, Oct 12 at 8:00 PM");
  assert.equal(describeReminder(r), '"give Dad his meds", every day at 8:00 PM');
});

test("STOP holds reminders; an active emergency holds them for a while", async () => {
  const store = new Store(null);
  await withReminder(store);
  const { sent, send } = sender();
  const due = () => new Date("2026-10-12T00:00:10Z");

  store.caregiver(C).optedOut = true;
  assert.equal(await deliverDue({ store, send, now: due }), 0);
  store.caregiver(C).optedOut = false;

  store.caregiver(C).lastEmergencyAt = "2026-10-11T23:50:00Z";
  assert.equal(await deliverDue({ store, send, now: due }), 0);
  const afterHold = () => new Date(Date.parse("2026-10-11T23:50:00Z") + EMERGENCY_HOLD_MS + 1000);
  assert.equal(await deliverDue({ store, send, now: afterHold }), 1);
  assert.equal(sent.length, 1);
});

test("a reminder sent late (bot was off) says when it was due", async () => {
  const store = new Store(null);
  await withReminder(store);
  const { sent, send } = sender();
  await deliverDue({ store, send, now: () => new Date("2026-10-12T02:00:00Z") });
  assert.match(sent[0]!, /this was due Sun, Oct 11 at 8:00 PM/);
});

test("failed sends retry, then give up after 3 attempts", async () => {
  const store = new Store(null);
  const r = await withReminder(store);
  const fail = async () => {
    throw new Error("network");
  };
  for (let i = 0; i < 3; i++) await deliverDue({ store, send: fail, now: () => new Date("2026-10-12T00:00:10Z") });
  assert.equal(r.status, "failed");
});

// --- AI tools ---------------------------------------------------------------

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const toolStep = (toolName: string, input: unknown) => ({
  content: [{ type: "tool-call" as const, toolCallId: "c1", toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
  usage,
  warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
  warnings: [],
});
const agentDeps = (store: Store, steps: unknown[]) => ({
  store,
  llm: { model: new MockLanguageModelV4({ doGenerate: steps as never }), modelId: "mock", baseURL: "mock://", providerOptions: {}, reasoningEffort: null },
  onEscalate: async () => false,
  defaultTimeZone: TZ,
  now: () => NOW,
});

test("set_reminder schedules in the caregiver's time zone and returns the confirmed time", async () => {
  const store = new Store(null);
  const d = agentDeps(store, [
    toolStep("set_reminder", { what: "give Dad his meds", time: "20:00", date: null, repeat: "daily", caregiver_said: "every day at 8pm" }),
    textStep("I'll remind you to give Dad his meds every day at 8:00 PM."),
  ]);
  const result = await runAgent(d, C, "remind me to give dad his meds every day at 8pm");
  const [r] = store.activeReminders(C);
  assert.ok(r);
  assert.equal(r.dueAt, "2026-10-12T00:00:00.000Z");
  assert.equal(r.repeat, "daily");
  assert.equal(result.reply, "I'll remind you to give Dad his meds every day at 8:00 PM.");
  const toolResult = JSON.stringify((d.llm.model as MockLanguageModelV4).doGenerateCalls[1]!.prompt);
  assert.match(toolResult, /every day at 8:00 PM/);
});

test("promising a reminder without scheduling it is caught", async () => {
  const store = new Store(null);
  const result = await runAgent(
    agentDeps(store, [
      toolStep("no_record_needed", { reason: "x" }),
      textStep("Sure, I'll remind you at 8."),
      toolStep("no_record_needed", { reason: "x" }),
      textStep("Okay, I'll remind you tonight."),
    ]),
    C,
    "can you remind me tonight",
  );
  assert.equal(store.activeReminders(C).length, 0);
  assert.equal(result.reply, REMINDER_CLARIFY_REPLY);
});

test("cancel_reminder cancels by id", async () => {
  const store = new Store(null);
  const r = await withReminder(store);
  await runAgent(
    agentDeps(store, [toolStep("cancel_reminder", { reminder_id: r.id, caregiver_said: "cancel the meds reminder" }), textStep("Done, cancelled.")]),
    C,
    "cancel the meds reminder",
  );
  assert.equal(r.status, "cancelled");
});

test("reminder promise detection", () => {
  assert.ok(claimsReminder("I'll remind you at 8:00 PM."));
  assert.ok(claimsReminder("Your reminder is set for tomorrow."));
  assert.ok(!claimsReminder("Would you like a reminder?"));
});

test("a repeating reminder needs the caregiver to have said it repeats", async () => {
  const store = new Store(null);
  await runAgent(
    agentDeps(store, [
      toolStep("set_reminder", { what: "give Dad his meds", time: "20:00", date: null, repeat: "daily", caregiver_said: "at 8pm" }),
      toolStep("set_reminder", { what: "give Dad his meds", time: "20:00", date: null, repeat: "none", caregiver_said: "at 8pm" }),
      textStep("I'll remind you at 8:00 PM tonight."),
    ]),
    C,
    "remind me to give dad his meds at 8pm",
  );
  const reminders = store.activeReminders(C);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0]!.repeat, "none");
});

test("interval reminders repeat every N days; cadence wording", async () => {
  const store = new Store(null);
  const r = await withReminder(store, { repeat: "interval", intervalDays: 28 });
  const { send } = sender();
  await deliverDue({ store, send, now: () => new Date("2026-10-12T00:00:10Z") });
  assert.equal(formatLocal(new Date(r.dueAt), TZ), "Sun, Nov 8 at 8:00 PM");
  assert.equal(cadence(28), "every 4 weeks");
  assert.equal(cadence(14), "every 2 weeks");
  assert.equal(cadence(10), "every 10 days");
});

test("compose can skip an occurrence without sending", async () => {
  const store = new Store(null);
  const r = await withReminder(store, { repeat: "interval", intervalDays: 28 });
  const { sent, send } = sender();
  await deliverDue({ store, send, compose: async () => null, now: () => new Date("2026-10-12T00:00:10Z") });
  assert.equal(sent.length, 0);
  assert.equal(r.status, "scheduled");
  assert.equal(formatLocal(new Date(r.dueAt), TZ), "Sun, Nov 8 at 8:00 PM");
});

test("change_reminder_time keeps the repeat and check-in link", async () => {
  const store = new Store(null);
  const r = await withReminder(store, { repeat: "interval", intervalDays: 28, checkIn: { instrument: "NPI-Q", patientLabel: "Dad" } });
  const moved = rescheduledDue(r, "09:00", NOW);
  assert.ok(moved.ok);
  await runAgent(
    agentDeps(store, [
      toolStep("change_reminder_time", { reminder_id: r.id, time: "09:00", caregiver_said: "reminder 9am instead" }),
      textStep("Moved it to 9:00 AM."),
    ]),
    C,
    "make the check-in reminder 9am instead",
  );
  assert.equal(r.repeat, "interval");
  assert.ok(r.checkIn);
  assert.equal(formatLocal(new Date(r.dueAt), TZ), "Mon, Oct 12 at 9:00 AM");
});
