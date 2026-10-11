// Seeds synthetic demo history for the Jonathan scenario into data/lucidity.json.
// Stop the bot first (it rewrites the file from memory).
//
//   npm run demo:seed                      # September baseline only (do the live NPI-Q/ZBI in the demo)
//   npm run demo:seed -- --full            # also a synthetic October check-in + caregiver messages
//   npm run demo:seed -- --caregiver +1555… --name Jonathan --label Dad
//
// Everything seeded is labeled synthetic (source "synthetic_demo").

import { randomUUID } from "node:crypto";
import { NPIQ_ITEMS, scoreNpiq } from "../instruments/npiq.ts";
import type { ItemResponse } from "../instruments/types.ts";
import { ZBI_ITEM_IDS, scoreZbi } from "../instruments/zbi.ts";
import { Store, type Assessment, type NpiDomain } from "../store.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const path = process.env.LUCIDITY_DATA_FILE?.trim() || "data/lucidity.json";
const store = new Store(path);
await store.load();

const caregiver =
  option("caregiver") ??
  process.env.DEMO_CAREGIVER_PHONE?.trim() ??
  store.caregiversByActivity().find((c) => c.address !== process.env.CLINICIAN_PHONE?.trim())?.address;
if (!caregiver) {
  console.error("No caregiver found. Text Lucidity once from the caregiver phone first, or pass --caregiver +1555….");
  process.exit(1);
}

const name = option("name") ?? "Jonathan";
const label = option("label") ?? "Dad";
const DAY = 86_400_000;
const now = Date.now();
const at = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

const state = store.caregiver(caregiver);
state.patientName = name;
state.patientLabel = label;

// NPI-Q severity/distress per domain. September totals 6/36 and 8/60; October 12/36 and 18/60.
const NPIQ_SEPT: Partial<Record<NpiDomain, [number, number]>> = {
  anxiety: [1, 2],
  aberrant_motor_behavior: [1, 2],
  depression_dysphoria: [1, 1],
  nighttime_behaviors: [1, 2],
  apathy_indifference: [2, 1],
};
const NPIQ_OCT: Partial<Record<NpiDomain, [number, number]>> = {
  anxiety: [3, 5],
  aberrant_motor_behavior: [3, 4],
  depression_dysphoria: [2, 3],
  nighttime_behaviors: [2, 4],
  apathy_indifference: [2, 2],
};
// ZBI items 1–12 (0–4). 10 of 12 items rise from September to October.
const ZBI_SEPT = [1, 1, 2, 0, 1, 0, 2, 2, 1, 1, 1, 1];
const ZBI_OCT = [2, 3, 3, 0, 2, 1, 3, 3, 2, 2, 1, 2];

function response(itemId: string, part: ItemResponse["part"], value: number | null, when: string): ItemResponse {
  return {
    itemId,
    part,
    questionText: "",
    rawReply: null,
    value,
    status: value === null ? "not_asked" : "valid",
    interpretedBy: "system",
    recordedAt: when,
  };
}

function npiq(ratings: Partial<Record<NpiDomain, [number, number]>>, daysAgo: number): Assessment {
  const when = at(daysAgo);
  const responses = NPIQ_ITEMS.flatMap((item) => {
    const r = ratings[item.domain];
    return r
      ? [response(item.id, "presence", 1, when), response(item.id, "severity", r[0], when), response(item.id, "distress", r[1], when)]
      : [response(item.id, "presence", 0, when), response(item.id, "severity", null, when), response(item.id, "distress", null, when)];
  });
  return assessment("NPI-Q", "past month", responses, scoreNpiq(responses), when);
}

function zbi(values: number[], daysAgo: number): Assessment {
  const when = at(daysAgo);
  const responses = ZBI_ITEM_IDS.map((id, i) => response(id, "frequency", values[i]!, when));
  return assessment("ZBI", "current", responses, scoreZbi(responses), when);
}

function assessment(
  instrument: Assessment["instrument"],
  recallPeriod: string,
  responses: ItemResponse[],
  scores: Assessment["scores"],
  when: string,
): Assessment {
  return {
    id: `asmt_demo_${randomUUID().slice(0, 6)}`,
    kind: "assessment",
    instrument,
    instrumentVersion: "synthetic demo fixture",
    administrationMode: "synthetic_fixture",
    recallPeriod,
    respondent: caregiver!,
    respondentRole: "caregiver",
    patientLabel: label,
    status: "completed",
    startedAt: when,
    updatedAt: when,
    completedAt: when,
    responses,
    cursor: { itemIndex: responses.length, part: "presence" },
    retries: 0,
    scores,
    source: "synthetic_demo",
  };
}

// September baseline: 30 days ago, so the live NPI-Q (28-day window) and ZBI
// (14-day window) can both be offered in the demo.
await store.addAssessment(npiq(NPIQ_SEPT, 30));
await store.addAssessment(zbi(ZBI_SEPT, 30));
let seeded = "September NPI-Q (severity 6/36, distress 8/60) and ZBI items 1–12 (13/48)";

if (flag("full")) {
  await store.addAssessment(npiq(NPIQ_OCT, 1));
  await store.addAssessment(zbi(ZBI_OCT, 1));
  const quotes: Array<[NpiDomain, string, 1 | 2 | 3, number]> = [
    ["anxiety", "dad is so anxious tonight. he keeps trying to get up and leave.", 3, 2],
    ["aberrant_motor_behavior", "he was pacing the hallway again after dinner", 3, 3],
    ["nighttime_behaviors", "up at 3am again, wandering around the kitchen", 2, 5],
  ];
  for (const [domain, quote, severity, daysAgo] of quotes) {
    const o = await store.addObservation({ caregiver, domain, severity, distress: null, quote, observedPeriod: "this week" });
    o.reportedAt = o.updatedAt = at(daysAgo);
  }
  seeded += ", October NPI-Q (12/36, 18/60) and ZBI (24/48), and 3 caregiver messages";
}

await store.commit();
console.log(`Seeded synthetic ${name} (${label}) for caregiver ${caregiver.slice(0, 5)}…: ${seeded}.`);
