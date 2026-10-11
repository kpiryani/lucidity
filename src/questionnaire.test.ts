import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswer } from "./answers.ts";
import { NPIQ_ITEMS, scoreNpiq, type NpiqScores, type NpiqWording } from "./instruments/npiq.ts";
import { ZBI_ITEM_IDS, type ZbiScores, type ZbiWording } from "./instruments/zbi.ts";
import type { Assessment } from "./store.ts";
import {
  handleOfferReply,
  handleQuestionnaireReply,
  handleScoreConsent,
  inProgress,
  npiqEligibility,
  paused,
  recordOffer,
  resume,
  startNpiq,
  assessmentContext,
  cueMet,
  checkInReminderText,
  handleCheckInReminderReply,
  start,
  stressCueMet,
  type QuestionnaireDeps,
} from "./questionnaire.ts";
import { Store } from "./store.ts";

// Placeholder wording so tests never depend on the licensed text.
const wording: NpiqWording = {
  instrument: "NPI-Q",
  version: "test",
  notice: "test",
  instructions: "INSTRUCTIONS",
  severityPrompt: "SEVERITY?",
  severityOptions: { "1": "mild", "2": "moderate", "3": "severe" },
  distressPrompt: "DISTRESS?",
  distressOptions: { "0": "a", "1": "b", "2": "c", "3": "d", "4": "e", "5": "f" },
  items: Object.fromEntries(
    NPIQ_ITEMS.map((item) => [item.id, { label: item.domain, question: `QUESTION ${item.id}?` }]),
  ) as NpiqWording["items"],
};

const C = "+15550000001";
const zbiWording: ZbiWording = {
  instrument: "ZBI",
  version: "test",
  notice: "test",
  instructions: "ZBI INSTRUCTIONS",
  scale: { "0": "NEVER", "1": "RARELY", "2": "SOMETIMES", "3": "QUITE FREQUENTLY", "4": "NEARLY ALWAYS" },
  items: Object.fromEntries(ZBI_ITEM_IDS.map((id) => [id, { question: `ZBI QUESTION ${id}?` }])),
};
const wordings = { "NPI-Q": wording, ZBI: zbiWording };
const deps = (store: Store, interpret?: QuestionnaireDeps["interpret"]): QuestionnaireDeps => ({ store, wordings, interpret });
const npi = (a: Assessment) => a.scores as NpiqScores | null;

async function started() {
  const store = new Store(null);
  const d = deps(store);
  await startNpiq(d, C, "Dad");
  return { store, d };
}

async function answerAll(d: QuestionnaireDeps, replies: string[]) {
  let last: string[] = [];
  for (const r of replies) last = await handleQuestionnaireReply(d, C, r);
  return last;
}

// --- answer parsing -------------------------------------------------------

test("clear answers parse by rule; don't-know is unknown, never no", () => {
  assert.deepEqual(parseAnswer("presence", "Yeah"), { kind: "answer", value: 1 });
  assert.deepEqual(parseAnswer("presence", "nope"), { kind: "answer", value: 0 });
  assert.deepEqual(parseAnswer("presence", "idk"), { kind: "unknown" });
  assert.deepEqual(parseAnswer("presence", "not sure"), { kind: "unknown" });
  assert.deepEqual(parseAnswer("presence", "skip"), { kind: "skip" });
  assert.deepEqual(parseAnswer("presence", "he did that a few times"), { kind: "unclear" });
  assert.deepEqual(parseAnswer("severity", "maybe a 2"), { kind: "answer", value: 2 });
  assert.deepEqual(parseAnswer("severity", "three"), { kind: "answer", value: 3 });
  assert.deepEqual(parseAnswer("severity", "4"), { kind: "unclear" }); // out of range
  assert.deepEqual(parseAnswer("distress", "0"), { kind: "answer", value: 0 });
  assert.deepEqual(parseAnswer("distress", "between 2 and 3"), { kind: "unclear" });
});

// --- scoring (LUCIDITY_CONNECT.md §3.3, §8) -------------------------------

test("all NO: complete, every domain absent, totals 0", async () => {
  const { store, d } = await started();
  const last = await answerAll(d, Array(12).fill("no"));
  const a = store.snapshot().assessments[0]!;
  assert.equal(a.status, "completed");
  assert.equal(npi(a)?.severityTotal, 0);
  assert.equal(npi(a)?.distressTotal, 0);
  assert.equal(npi(a)?.symptomsPresent, 0);
  assert.ok(npi(a)?.domains.every((x) => x.present === false && x.severity === 0 && x.distress === 0));
  assert.match(last.join("\n"), /Would you like to see your results/);
});

test("YES branches to severity then distress; separate totals", async () => {
  const { store, d } = await started();
  // Item 1 yes (sev 2, dis 3), item 2 yes (sev 1, dis 4), rest no.
  await answerAll(d, ["yes", "2", "3", "yes", "1", "4", ...Array(10).fill("no")]);
  const scores = npi(store.snapshot().assessments[0]!)!;
  assert.equal(scores.complete, true);
  assert.equal(scores.severityTotal, 3);
  assert.equal(scores.distressTotal, 7);
  assert.equal(scores.symptomsPresent, 2);
});

test("out-of-range severity is not accepted", async () => {
  const { store, d } = await started();
  const reply = await handleQuestionnaireReply(d, C, "yes");
  assert.match(reply[0]!, /SEVERITY\?/);
  const again = await handleQuestionnaireReply(d, C, "5"); // severity must be 1–3
  assert.match(again[0]!, /didn't quite get that/);
  assert.match(again[0]!, /SEVERITY\?/);
  assert.equal(store.snapshot().assessments[0]!.cursor.part, "severity");
});

test("unknown and skipped stay missing; no fabricated totals", async () => {
  const { store, d } = await started();
  await answerAll(d, ["idk", "skip", ...Array(10).fill("no")]);
  const a = store.snapshot().assessments[0]!;
  assert.equal(a.status, "incomplete");
  assert.equal(npi(a)?.severityTotal, null);
  assert.equal(npi(a)?.distressTotal, null);
  assert.deepEqual(npi(a)?.missingItemIds, ["NPIQ-01", "NPIQ-02"]);
  const first = a.responses.find((r) => r.itemId === "NPIQ-01" && r.part === "presence")!;
  assert.equal(first.status, "unknown");
  assert.equal(first.value, null);
});

test("each response stores the exact text shown and the raw reply", async () => {
  const { store, d } = await started();
  await handleQuestionnaireReply(d, C, "Yeah");
  const r = store.snapshot().assessments[0]!.responses[0]!;
  assert.match(r.questionText, /QUESTION NPIQ-01\?/);
  assert.equal(r.rawReply, "Yeah");
  assert.equal(r.status, "valid");
  assert.equal(r.interpretedBy, "rule");
});

// --- unclear replies --------------------------------------------------------

test("unclear reply gets a clarification and the question re-sent verbatim", async () => {
  const store = new Store(null);
  const d = deps(store, async () => ({ parsed: { kind: "unclear" }, clarification: "It means believing things that aren't true." }));
  await startNpiq(d, C, "Dad");
  const reply = await handleQuestionnaireReply(d, C, "what counts as a false belief?");
  assert.match(reply[0]!, /It means believing things that aren't true\./);
  assert.match(reply[0]!, /QUESTION NPIQ-01\?/);
  assert.equal(store.snapshot().assessments[0]!.responses.length, 0);
});

test("LLM-interpreted answer is confirmed back", async () => {
  const store = new Store(null);
  const d = deps(store, async () => ({ parsed: { kind: "answer", value: 1 }, clarification: null }));
  await startNpiq(d, C, "Dad");
  const reply = await handleQuestionnaireReply(d, C, "he's been doing that lately");
  assert.match(reply[0]!, /^Got it: Yes\./);
  assert.equal(store.snapshot().assessments[0]!.responses[0]!.interpretedBy, "llm");
});

test("two unclear replies mark the item unknown and move on", async () => {
  const { store, d } = await started();
  await handleQuestionnaireReply(d, C, "hmm");
  const second = await handleQuestionnaireReply(d, C, "hmm");
  assert.match(second[0]!, /mark that one as not sure/);
  assert.match(second[0]!, /QUESTION NPIQ-02\?/);
  const r = store.snapshot().assessments[0]!.responses[0]!;
  assert.equal(r.status, "unknown");
});

// --- pause / resume ---------------------------------------------------------

test("pause and resume pick up at the same question", async () => {
  const { store, d } = await started();
  await handleQuestionnaireReply(d, C, "no");
  const p = await handleQuestionnaireReply(d, C, "pause");
  assert.match(p[0]!, /Paused\. Reply RESUME/);
  assert.equal(inProgress(store, C), undefined);
  assert.ok(paused(store, C));
  const r = (await resume(d, C))!;
  assert.match(r.join("\n"), /QUESTION NPIQ-02\?/);
  assert.ok(inProgress(store, C));
});

test("intro mentions PAUSE and RESUME and who it's about", async () => {
  const store = new Store(null);
  const [intro, first] = await startNpiq(deps(store), C, "Dad");
  assert.match(intro!, /PAUSE anytime to pause, and RESUME to continue/);
  assert.match(intro!, /that means Dad/);
  assert.match(first!, /^1\/12/);
});

// --- offers, eligibility, consent -------------------------------------------

test("offer YES starts the questionnaire; NO starts a cooldown", async () => {
  const store = new Store(null);
  const d = deps(store);
  await recordOffer(store, C, "Dad");
  const yes = (await handleOfferReply(d, C, "yes"))!;
  assert.match(yes.join("\n"), /QUESTION NPIQ-01\?/);

  const store2 = new Store(null);
  await recordOffer(store2, C, "Dad");
  await handleOfferReply(deps(store2), C, "no thanks");
  assert.equal(npiqEligibility(store2, C).ok, false);
});

test("an unclear reply to an offer drops it and goes to the AI", async () => {
  const store = new Store(null);
  await recordOffer(store, C, "Dad");
  assert.equal(await handleOfferReply(deps(store), C, "what is it exactly?"), null);
  assert.equal(store.caregiver(C).pendingOffer, undefined);
});

test("not offered again within 28 days of a completed NPI-Q", async () => {
  const { store, d } = await started();
  await answerAll(d, Array(12).fill("no"));
  const e = npiqEligibility(store, C);
  assert.equal(e.ok, false);
  assert.equal((await recordOffer(store, C, "Dad")).ok, false);
});

test("score consent is asked once and remembered", async () => {
  const { store, d } = await started();
  await answerAll(d, ["yes", "2", "3", ...Array(11).fill("no")]);
  const shown = (await handleScoreConsent(d, C, "yes"))!;
  assert.match(shown[0]!, /severity 2 of 3, distress 3 of 5/);
  assert.match(shown[0]!, /Total severity: 2 of 36/);
  assert.equal(store.caregiver(C).scoreConsent, true);
});

test("scoreNpiq: later answers supersede earlier ones", () => {
  const base = { questionText: "", rawReply: "", interpretedBy: "rule" as const, recordedAt: "" };
  const scores = scoreNpiq([
    ...NPIQ_ITEMS.map((i) => ({ ...base, itemId: i.id, part: "presence" as const, value: 0, status: "valid" as const })),
    { ...base, itemId: "NPIQ-03", part: "presence", value: 1, status: "valid" },
    { ...base, itemId: "NPIQ-03", part: "severity", value: 3, status: "valid" },
    { ...base, itemId: "NPIQ-03", part: "distress", value: 5, status: "valid" },
  ]);
  assert.equal(scores.severityTotal, 3);
  assert.equal(scores.distressTotal, 5);
});

test("cue: two different symptoms this week tells the AI to offer, once a day", async () => {
  const store = new Store(null);
  const obs = (domain: "agitation_aggression" | "delusions") =>
    store.addObservation({ caregiver: C, domain, severity: null, distress: null, quote: "q", observedPeriod: null });
  await obs("agitation_aggression");
  assert.equal(cueMet(store, C), false);
  await obs("delusions");
  assert.equal(cueMet(store, C), true);
  assert.match(assessmentContext(store, C, store.caregiver(C), new Date(), wordings), /CUE MET for the NPI-Q/);
  await recordOffer(store, C, "Dad");
  store.caregiver(C).pendingOffer = undefined;
  assert.match(assessmentContext(store, C, store.caregiver(C), new Date(), wordings), /already offered today/);
});

// --- ZBI (items 1–12) -------------------------------------------------------

test("ZBI: frequency words and numbers parse; never means 0", () => {
  assert.deepEqual(parseAnswer("frequency", "never"), { kind: "answer", value: 0 });
  assert.deepEqual(parseAnswer("frequency", "Sometimes"), { kind: "answer", value: 2 });
  assert.deepEqual(parseAnswer("frequency", "quite frequently"), { kind: "answer", value: 3 });
  assert.deepEqual(parseAnswer("frequency", "4"), { kind: "answer", value: 4 });
  assert.deepEqual(parseAnswer("frequency", "5"), { kind: "unclear" });
});

test("ZBI: one prompt per item, total 0–48 when complete", async () => {
  const store = new Store(null);
  const d = deps(store);
  const [intro, first] = await start(d, C, "ZBI", "Dad");
  assert.match(intro!, /about you/);
  assert.match(intro!, /PAUSE anytime to pause, and RESUME to continue/);
  assert.match(first!, /^1\/12\nZBI QUESTION ZBI-01\?/);
  const replies = ["0", "1", "2", "3", "4", "never", "rarely", "sometimes", "often", "nearly always", "2", "2"];
  let last: string[] = [];
  for (const r of replies) last = await handleQuestionnaireReply(d, C, r);
  const a = store.snapshot().assessments[0]!;
  const scores = a.scores as ZbiScores;
  assert.equal(a.instrument, "ZBI");
  assert.equal(a.status, "completed");
  assert.equal(scores.total, 0 + 1 + 2 + 3 + 4 + 0 + 1 + 2 + 3 + 4 + 2 + 2);
  assert.equal(a.responses.filter((r) => r.status === "not_asked").length, 0);
  assert.match(last.join("\n"), /caring for|feeling/);
});

test("ZBI: an unsure answer leaves the total uncalculated", async () => {
  const store = new Store(null);
  const d = deps(store);
  await start(d, C, "ZBI", "Dad");
  for (const r of ["idk", ...Array(11).fill("1")]) await handleQuestionnaireReply(d, C, r);
  const a = store.snapshot().assessments[0]!;
  assert.equal(a.status, "incomplete");
  assert.equal((a.scores as ZbiScores).total, null);
  await handleScoreConsent(d, C, "yes").then((m) => assert.match(m![0]!, /total isn't calculated/));
});

test("ZBI cue: caregiver stress note this week; ZBI is offered before the NPI-Q", async () => {
  const store = new Store(null);
  assert.equal(stressCueMet(store, C), false);
  await store.addNote({ caregiver: C, topic: "caregiver_wellbeing", summary: "Exhausted", quote: "I'm exhausted", observedPeriod: null });
  assert.equal(stressCueMet(store, C), true);
  for (const domain of ["agitation_aggression", "delusions"] as const) {
    await store.addObservation({ caregiver: C, domain, severity: null, distress: null, quote: "q", observedPeriod: null });
  }
  assert.match(assessmentContext(store, C, store.caregiver(C), new Date(), wordings), /CUE MET for the ZBI/);
});

test("ZBI offer: YES starts the ZBI", async () => {
  const store = new Store(null);
  await recordOffer(store, C, "Dad", new Date(), "ZBI");
  const out = (await handleOfferReply(deps(store), C, "yes"))!;
  assert.match(out.join("\n"), /ZBI QUESTION ZBI-01\?/);
});

// --- recurring check-in reminders ---------------------------------------------

const NOW = new Date("2026-10-11T19:00:00Z"); // Sun Oct 11, 3 PM New York
const timed = (store: Store): QuestionnaireDeps => ({ store, wordings, now: () => NOW, timeZone: "America/New_York" });

async function finishNpiq(d: QuestionnaireDeps, consent: "yes" | "no" | null = "yes") {
  await start(d, C, "NPI-Q", "Dad");
  let out: string[] = [];
  for (const r of Array(12).fill("no")) out = await handleQuestionnaireReply(d, C, r);
  if (consent) out = (await handleScoreConsent(d, C, consent))!;
  return out;
}

test("first completed check-in asks once about a recurring reminder (after results consent)", async () => {
  const store = new Store(null);
  const d = timed(store);
  const out = await finishNpiq(d);
  assert.match(out.join("\n"), /Want me to remind you\? I'd text you on Sun, Nov 8 at 6:00 PM, then every 4 weeks\. Reply YES or NO\./);
  assert.equal(store.caregiver(C).checkInReminderPrompt?.status, "asked");
});

test("YES creates an every-4-weeks NPI-Q reminder at 6 PM local", async () => {
  const store = new Store(null);
  const d = timed(store);
  await finishNpiq(d);
  const reply = (await handleCheckInReminderReply(d, C, "yes"))!;
  assert.match(reply[0]!, /every 4 weeks, starting Sun, Nov 8 at 6:00 PM/);
  const [r] = store.activeReminders(C);
  assert.equal(r?.repeat, "interval");
  assert.equal(r?.intervalDays, 28);
  assert.equal(r?.dueAt, "2026-11-08T23:00:00.000Z"); // 6 PM EST
  assert.deepEqual(r?.checkIn, { instrument: "NPI-Q", patientLabel: "Dad" });
});

test("NO doesn't create a reminder, and it isn't asked again after a second check-in", async () => {
  const store = new Store(null);
  const d = timed(store);
  await finishNpiq(d);
  await handleCheckInReminderReply(d, C, "no");
  assert.equal(store.activeReminders(C).length, 0);
  // A later NPI-Q: no question this time.
  const out = await finishNpiq(d, null);
  assert.doesNotMatch(out.join("\n"), /Want me to remind you/);
});

test("ZBI first completion offers every 2 weeks", async () => {
  const store = new Store(null);
  const d = timed(store);
  store.caregiver(C).scoreConsent = false;
  await start(d, C, "ZBI", "Dad");
  let out: string[] = [];
  for (const r of Array(12).fill("1")) out = await handleQuestionnaireReply(d, C, r);
  assert.match(out.join("\n"), /repeated every 2 weeks/);
});

test("when a check-in reminder fires it becomes an invitation; YES starts the check-in", async () => {
  const store = new Store(null);
  const d = timed(store);
  await finishNpiq(d);
  await handleCheckInReminderReply(d, C, "yes");
  const [r] = store.activeReminders(C);
  const due = new Date(r!.dueAt);
  const text = await checkInReminderText(store, wordings, r!, due);
  assert.match(text!, /time for Dad's NPI-Q check-in.*Reply YES or NO/);
  const started = (await handleOfferReply({ ...d, now: () => due }, C, "yes"))!;
  assert.match(started.join("\n"), /QUESTION NPIQ-01\?/);
});

test("a check-in reminder is skipped if the check-in was just done", async () => {
  const store = new Store(null);
  const d = timed(store);
  await finishNpiq(d);
  await handleCheckInReminderReply(d, C, "yes");
  const [r] = store.activeReminders(C);
  // Simulate an early retake: the reminder fires one day after a completed NPI-Q.
  const early = new Date(NOW.getTime() + 86_400_000);
  assert.equal(await checkInReminderText(store, wordings, r!, early), null);
});
