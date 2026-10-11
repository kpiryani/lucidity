import { test } from "node:test";
import assert from "node:assert/strict";
import { CLINICIAN_HELP, captureCareReply, handleClinicianMessage, nudgeClinician, type CareDeps } from "./care.ts";
import { NPIQ_ITEMS, scoreNpiq } from "./instruments/npiq.ts";
import type { ItemResponse } from "./instruments/types.ts";
import { ZBI_ITEM_IDS, scoreZbi } from "./instruments/zbi.ts";
import { compileProfile, compareNpiq, suggestedQuestions, zbiItemsRose } from "./profile.ts";
import { Store, type Assessment, type NpiDomain } from "./store.ts";

const CG = "+15550000001";
const DOC = "+15550000009";
const NOW = new Date("2026-10-11T14:00:00Z");
const DAY = 86_400_000;

function resp(itemId: string, part: ItemResponse["part"], value: number | null): ItemResponse {
  return { itemId, part, questionText: "", rawReply: null, value, status: value === null ? "not_asked" : "valid", interpretedBy: "system", recordedAt: "" };
}

function npiq(store: Store, ratings: Partial<Record<NpiDomain, [number, number]>>, daysAgo: number) {
  const responses = NPIQ_ITEMS.flatMap((i) => {
    const r = ratings[i.domain];
    return r ? [resp(i.id, "presence", 1), resp(i.id, "severity", r[0]), resp(i.id, "distress", r[1])] : [resp(i.id, "presence", 0)];
  });
  return add(store, "NPI-Q", responses, scoreNpiq(responses), daysAgo);
}

function zbi(store: Store, values: number[], daysAgo: number) {
  const responses = ZBI_ITEM_IDS.map((id, i) => resp(id, "frequency", values[i]!));
  return add(store, "ZBI", responses, scoreZbi(responses), daysAgo);
}

function add(store: Store, instrument: Assessment["instrument"], responses: ItemResponse[], scores: Assessment["scores"], daysAgo: number) {
  const when = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
  return store.addAssessment({
    id: `a${Math.random()}`, kind: "assessment", instrument, instrumentVersion: "t", administrationMode: "synthetic_fixture",
    recallPeriod: "past month", respondent: CG, respondentRole: "caregiver", patientLabel: "Dad", status: "completed",
    startedAt: when, updatedAt: when, completedAt: when, responses, cursor: { itemIndex: 0, part: "presence" }, retries: 0, scores,
    source: "synthetic_demo",
  });
}

/** The Jonathan scenario: September vs October. */
async function jonathan() {
  const store = new Store(null);
  const s = store.caregiver(CG);
  s.patientName = "Jonathan";
  s.patientLabel = "Dad";
  await store.appendTurn(CG, "user", "hi");
  await npiq(store, { anxiety: [1, 2], aberrant_motor_behavior: [1, 2], depression_dysphoria: [1, 1], nighttime_behaviors: [1, 2], apathy_indifference: [2, 1] }, 30);
  await npiq(store, { anxiety: [3, 5], aberrant_motor_behavior: [3, 4], depression_dysphoria: [2, 3], nighttime_behaviors: [2, 4], apathy_indifference: [2, 2] }, 1);
  await zbi(store, [1, 1, 2, 0, 1, 0, 2, 2, 1, 1, 1, 1], 30);
  await zbi(store, [2, 3, 3, 0, 2, 1, 3, 3, 2, 2, 1, 2], 1);
  const o = await store.addObservation({ caregiver: CG, domain: "anxiety", severity: 3, distress: null, quote: "dad is so anxious tonight. he keeps trying to get up and leave.", observedPeriod: "tonight" });
  o.reportedAt = new Date(NOW.getTime() - DAY).toISOString();
  return store;
}

function care(store: Store) {
  const sent: Array<{ to: string; text: string }> = [];
  const deps: CareDeps = {
    store,
    clinician: DOC,
    send: async (to, text) => void sent.push({ to, text }),
    currentCaregiver: () => CG,
    now: () => NOW,
  };
  return { deps, sent };
}

// --- Intelligence -------------------------------------------------------------

test("profile shows the Jonathan September-to-October changes, computed by code", async () => {
  const store = await jonathan();
  const profile = compileProfile(store, CG, NOW);
  assert.match(profile, /^JONATHAN — Lucidity profile/);
  assert.match(profile, /Anxiety: 1 to 3/);
  assert.match(profile, /Pacing or wandering: 1 to 3/);
  assert.match(profile, /Low mood: 1 to 2/);
  assert.match(profile, /Night-time waking: 1 to 2/);
  assert.match(profile, /Loss of interest: 2, no change/);
  assert.match(profile, /Total severity: 6 to 12 of 36\. Caregiver distress: 8 to 18 of 60\./);
  assert.match(profile, /10 of 12 questions rose/);
  assert.match(profile, /partial record/);
  assert.match(profile, /"dad is so anxious tonight\. he keeps trying to get up and leave\."/);
});

test("comparisons and suggested questions", async () => {
  const store = await jonathan();
  const [oct, sept] = store.assessmentsFor(CG, "NPI-Q");
  assert.equal(compareNpiq(sept!, oct!).find((c) => c.domain === "anxiety")?.after, 3);
  const [zOct, zSept] = store.assessmentsFor(CG, "ZBI");
  assert.deepEqual(zbiItemsRose(zSept!, zOct!), { rose: 10, compared: 12 });
  const [first] = suggestedQuestions(store, CG, NOW);
  assert.match(first!.text, /Dad's (anxiety|pacing or wandering) tend to happen at a particular time of day/);
});

test("an empty profile doesn't break", () => {
  const store = new Store(null);
  assert.match(compileProfile(store, CG, NOW), /No NPI-Q yet\./);
});

// --- Care: clinician commands -------------------------------------------------

test("HELP and PROFILE", async () => {
  const store = await jonathan();
  const { deps } = care(store);
  assert.deepEqual(await handleClinicianMessage(deps, "help"), [CLINICIAN_HELP]);
  assert.match((await handleClinicianMessage(deps, "profile"))[0]!, /JONATHAN/);
});

test("RECOMMEND drafts, nothing is sent until APPROVE, then Connect delivers the exact text", async () => {
  const store = await jonathan();
  const { deps, sent } = care(store);
  const draft = await handleClinicianMessage(deps, "RECOMMEND That sounds like a hard evening. Dim the lights and lower the noise tonight. Reply YES, or skip.");
  assert.match(draft[0]!, /Draft recommendation/);
  assert.match(draft[0]!, /From Dad's care team: That sounds like a hard evening/);
  assert.equal(sent.length, 0);

  const ok = await handleClinicianMessage(deps, "approve");
  assert.match(ok[0]!, /Sent to the caregiver/);
  assert.deepEqual(sent, [
    { to: CG, text: "From Dad's care team: That sounds like a hard evening. Dim the lights and lower the noise tonight. Reply YES, or skip." },
  ]);
  assert.ok(store.caregiver(CG).awaitingCareReplyFor);
  assert.match(store.recentHistory(CG).at(-1)!.text, /From Dad's care team/);
});

test("EDIT changes the draft; CANCEL sends nothing", async () => {
  const store = await jonathan();
  const { deps, sent } = care(store);
  await handleClinicianMessage(deps, "ASK does it start after dinner?");
  const edited = await handleClinicianMessage(deps, "EDIT Does the anxiety usually start before or after dinner?");
  assert.match(edited[0]!, /Question from Dad's care team: Does the anxiety usually start before or after dinner\?/);
  assert.match((await handleClinicianMessage(deps, "cancel"))[0]!, /Nothing was sent/);
  assert.equal(sent.length, 0);
  assert.match((await handleClinicianMessage(deps, "approve"))[0]!, /no draft/);
});

test("ASK 1 uses the first suggested question", async () => {
  const store = await jonathan();
  const { deps } = care(store);
  const [suggested] = suggestedQuestions(store, CG, NOW);
  const draft = await handleClinicianMessage(deps, "ASK 1");
  assert.ok(draft[0]!.includes(suggested!.text));
});

test("not sent when the caregiver opted out", async () => {
  const store = await jonathan();
  const { deps, sent } = care(store);
  store.caregiver(CG).optedOut = true;
  await handleClinicianMessage(deps, "RECOMMEND Try a calm evening routine.");
  assert.match((await handleClinicianMessage(deps, "approve"))[0]!, /opted out/);
  assert.equal(sent.length, 0);
});

test("unknown clinician text gets a hint, never the AI", async () => {
  const store = await jonathan();
  const { deps } = care(store);
  assert.match((await handleClinicianMessage(deps, "how is he doing?"))[0]!, /Reply HELP/);
});

// --- Connect: caregiver replies -----------------------------------------------

test("YES to a recommendation is saved, acknowledged, and forwarded to the clinician", async () => {
  const store = await jonathan();
  const { deps, sent } = care(store);
  await handleClinicianMessage(deps, "RECOMMEND Dim the lights tonight. Reply YES, or skip.");
  await handleClinicianMessage(deps, "approve");
  const result = (await captureCareReply(deps, CG, "YES"))!;
  assert.equal(result.handled, true);
  assert.match(result.toCaregiver[0]!, /let Dad's care team know you'll try it/);
  assert.equal(store.careMessagesFor(CG).at(-1)!.reply?.text, "YES");
  assert.match(sent.at(-1)!.text, /Caregiver replied to your recommendation/);
  assert.equal(sent.at(-1)!.to, DOC);
  assert.equal(await captureCareReply(deps, CG, "another message"), null); // only the first reply
});

test("a longer answer to a question goes on to the AI with a note", async () => {
  const store = await jonathan();
  const { deps } = care(store);
  await handleClinicianMessage(deps, "ASK Does the anxiety start before or after dinner?");
  await handleClinicianMessage(deps, "approve");
  const result = (await captureCareReply(deps, CG, "usually right after dinner, around 7"))!;
  assert.equal(result.handled, false);
  assert.match(result.aiNote!, /reply to this question from the care team/);
});

test("clinician nudges are rate-limited to once an hour unless forced", async () => {
  const store = await jonathan();
  const { deps, sent } = care(store);
  await nudgeClinician(deps, CG, "a behavior change");
  await nudgeClinician(deps, CG, "another change");
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text, /New update for Jonathan: a behavior change\. Reply PROFILE/);
  await nudgeClinician(deps, CG, "NPI-Q check-in completed", true);
  assert.equal(sent.length, 2);
});
