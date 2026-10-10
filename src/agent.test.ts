import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { runAgent, type AgentDeps } from "./agent.ts";
import { Store } from "./store.ts";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const toolStep = (calls: Array<{ toolName: string; input: unknown }>) => ({
  content: calls.map((c, i) => ({
    type: "tool-call" as const,
    toolCallId: `call_${i}`,
    toolName: c.toolName,
    input: JSON.stringify(c.input),
  })),
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

function deps(store: Store, steps: unknown[], escalations: string[] = []): AgentDeps {
  return {
    store,
    llm: {
      model: new MockLanguageModelV4({ doGenerate: steps as never }),
      modelId: "mock",
      baseURL: "mock://",
      providerOptions: {},
      reasoningEffort: null,
    },
    onEscalate: async (_caregiver, reason) => {
      escalations.push(reason);
    },
  };
}

test("logs an observation with unknown scores left null, then replies", async () => {
  const store = new Store(null);
  const result = await runAgent(
    deps(store, [
      toolStep([
        {
          toolName: "log_npi_observation",
          input: { domain: "nighttime_behaviors", quote: "up pacing all night again", observed_period: "last night" },
        },
      ]),
      textStep("That sounds exhausting. How intense was it: 1, 2, or 3?"),
    ]),
    "+15550000001",
    "Dad was up pacing all night again",
  );

  assert.equal(result.reply, "That sounds exhausting. How intense was it: 1, 2, or 3?");
  assert.deepEqual(result.toolCalls, ["log_npi_observation"]);
  const [obs] = store.snapshot().observations;
  assert.ok(obs);
  assert.equal(obs.domain, "nighttime_behaviors");
  assert.equal(obs.severity, null);
  assert.equal(obs.distress, null);
  assert.equal(obs.observedPeriod, "last night");
  assert.equal(obs.caregiver, "+15550000001");
});

test("follow-up answer updates the record and keeps a revision", async () => {
  const store = new Store(null);
  const obs = await store.addObservation({
    caregiver: "+15550000001",
    domain: "nighttime_behaviors",
    severity: null,
    distress: null,
    quote: "up all night",
    observedPeriod: null,
  });

  await runAgent(
    deps(store, [
      toolStep([{ toolName: "update_observation", input: { observation_id: obs.id, severity: 2, distress: 4 } }]),
      textStep("Got it, thank you."),
    ]),
    "+15550000001",
    "2, and like a 4",
  );

  assert.equal(obs.severity, 2);
  assert.equal(obs.distress, 4);
  assert.deepEqual(obs.revisions[0]?.previous, { severity: null, distress: null });
});

test("a caregiver cannot update another caregiver's record", async () => {
  const store = new Store(null);
  const obs = await store.addObservation({
    caregiver: "+15550000001",
    domain: "anxiety",
    severity: null,
    distress: null,
    quote: "anxious",
    observedPeriod: null,
  });

  await runAgent(
    deps(store, [
      toolStep([{ toolName: "update_observation", input: { observation_id: obs.id, severity: 3 } }]),
      textStep("Okay."),
    ]),
    "+15550000002",
    "it was a 3",
  );

  assert.equal(obs.severity, null);
});

test("invalid tool input is rejected and nothing is saved", async () => {
  const store = new Store(null);
  await runAgent(
    deps(store, [
      toolStep([
        { toolName: "log_npi_observation", input: { domain: "nighttime_behaviors", severity: 7, quote: "bad night" } },
      ]),
      textStep("Sorry about the rough night."),
    ]),
    "+15550000001",
    "bad night",
  );

  assert.equal(store.snapshot().observations.length, 0);
});

test("escalate_urgent calls the escalation hook once", async () => {
  const store = new Store(null);
  const escalations: string[] = [];
  const result = await runAgent(
    deps(
      store,
      [
        toolStep([
          { toolName: "escalate_urgent", input: { reason: "possible fall", quote: "found him on the floor" } },
          { toolName: "escalate_urgent", input: { reason: "possible fall", quote: "found him on the floor" } },
        ]),
        textStep("I'm here with you."),
      ],
      escalations,
    ),
    "+15550000001",
    "found him on the floor this morning",
  );

  assert.equal(result.escalated, true);
  assert.deepEqual(escalations, ["possible fall"]);
});

test("lucidity episode keeps unknown details null", async () => {
  const store = new Store(null);
  await runAgent(
    deps(store, [
      toolStep([
        {
          toolName: "log_lucidity_episode",
          input: {
            quote: "Mom called me by name and asked about my kids",
            what_was_said_or_done: "called me by name and asked about my kids",
          },
        },
      ]),
      textStep("What a meaningful moment. About how long did it last?"),
    ]),
    "+15550000001",
    "Mom called me by name and asked about my kids today!",
  );

  const [episode] = store.snapshot().lucidityEpisodes;
  assert.ok(episode);
  assert.equal(episode.whatWasSaidOrDone, "called me by name and asked about my kids");
  assert.equal(episode.duration, null);
  assert.equal(episode.afterState, null);
});

test("history and recent records are sent to the model", async () => {
  const store = new Store(null);
  await store.appendTurn("+15550000001", "user", "hi");
  await store.appendTurn("+15550000001", "assistant", "Hello!");
  await store.addObservation({
    caregiver: "+15550000001",
    domain: "anxiety",
    severity: null,
    distress: null,
    quote: "very anxious",
    observedPeriod: null,
  });
  const d = deps(store, [textStep("ok")]);
  await runAgent(d, "+15550000001", "thanks");

  const call = (d.llm.model as MockLanguageModelV4).doGenerateCalls[0]!;
  const serialized = JSON.stringify(call.prompt);
  assert.match(serialized, /Hello!/);
  assert.match(serialized, /very anxious/);
  assert.match(serialized, /missing severity, distress/);
});
