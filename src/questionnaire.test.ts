import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswer } from "./answers.ts";
import { NPIQ_ITEMS, scoreNpiq, type NpiqWording } from "./instruments/npiq.ts";
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
const deps = (store: Store, interpret?: QuestionnaireDeps["interpret"]): QuestionnaireDeps => ({ store, wording, interpret });

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
  assert.equal(a.scores?.severityTotal, 0);
  assert.equal(a.scores?.distressTotal, 0);
  assert.equal(a.scores?.symptomsPresent, 0);
  assert.ok(a.scores?.domains.every((x) => x.present === false && x.severity === 0 && x.distress === 0));
  assert.match(last.join("\n"), /Would you like to see your results/);
});

test("YES branches to severity then distress; separate totals", async () => {
  const { store, d } = await started();
  // Item 1 yes (sev 2, dis 3), item 2 yes (sev 1, dis 4), rest no.
  await answerAll(d, ["yes", "2", "3", "yes", "1", "4", ...Array(10).fill("no")]);
  const scores = store.snapshot().assessments[0]!.scores!;
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
  assert.equal(a.scores?.severityTotal, null);
  assert.equal(a.scores?.distressTotal, null);
  assert.deepEqual(a.scores?.missingItemIds, ["NPIQ-01", "NPIQ-02"]);
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
  assert.match(assessmentContext(store, C, store.caregiver(C)), /CUE MET/);
  await recordOffer(store, C, "Dad");
  store.caregiver(C).pendingOffer = undefined;
  assert.match(assessmentContext(store, C, store.caregiver(C)), /already offered today/);
});
