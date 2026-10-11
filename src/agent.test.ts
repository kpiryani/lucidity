import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { CLARIFY_REPLY, claimsSave, guessPatientLabel, invitesCheckIn, runAgent, type AgentDeps } from "./agent.ts";
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

const noRecord = () => toolStep([{ toolName: "no_record_needed", input: { reason: "small talk" } }]);

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
      return false;
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
      toolStep([
        {
          toolName: "update_observation",
          input: { observation_id: obs.id, caregiver_said: "2, and like a 4", severity: 2, distress: 4 },
        },
      ]),
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
      toolStep([
        { toolName: "update_observation", input: { observation_id: obs.id, caregiver_said: "it was a 3", severity: 3 } },
      ]),
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
  const d = deps(store, [noRecord(), textStep("ok")]);
  await runAgent(d, "+15550000001", "thanks");

  const call = (d.llm.model as MockLanguageModelV4).doGenerateCalls[0]!;
  const serialized = JSON.stringify(call.prompt);
  assert.match(serialized, /Hello!/);
  assert.match(serialized, /very anxious/);
  assert.match(serialized, /missing severity, distress/);
});

test("claimsSave recognizes save claims", () => {
  assert.ok(claimsSave("Of course — I've updated that to a 3."));
  assert.ok(claimsSave("Thank you, I’ve noted it."));
  assert.ok(claimsSave("No worries, I corrected that."));
  assert.ok(!claimsSave("How intense was it: 1, 2, or 3?"));
  assert.ok(!claimsSave("That sounds exhausting."));
});

test("a save claim with no tool call is retried, and the retry's real save is used", async () => {
  const store = new Store(null);
  const obs = await store.addObservation({
    caregiver: "+15550000001",
    domain: "agitation_aggression",
    severity: 2,
    distress: 4,
    quote: "agitated at dinner",
    observedPeriod: null,
  });
  const d = deps(store, [
    noRecord(),
    textStep("Of course — I've updated that to a 3."), // claims a save, no record tool
    toolStep([
      {
        toolName: "update_observation",
        input: { observation_id: obs.id, caregiver_said: "more like a 3", severity: 3 },
      },
    ]),
    textStep("Updated to a 3."),
  ]);
  const result = await runAgent(d, "+15550000001", "actually it was more like a 3");

  assert.equal(obs.severity, 3);
  assert.equal(result.reply, "Updated to a 3.");
  const retryCall = (d.llm.model as MockLanguageModelV4).doGenerateCalls[2]!;
  assert.match(JSON.stringify(retryCall.prompt), /no record tool was called/);
});

test("a repeated save claim with no tool call becomes a clarifying question", async () => {
  const store = new Store(null);
  const result = await runAgent(
    deps(store, [noRecord(), textStep("I've updated that to a 3."), noRecord(), textStep("Done, I've updated it.")]),
    "+15550000001",
    "actually it was more like a 3",
  );
  assert.equal(result.reply, CLARIFY_REPLY);
});

test("a failed update does not count as a save", async () => {
  const store = new Store(null);
  const result = await runAgent(
    deps(store, [
      toolStep([
        {
          toolName: "update_observation",
          input: { observation_id: "obs_missing", caregiver_said: "make it a 3", severity: 3 },
        },
      ]),
      textStep("I've updated it."),
      noRecord(),
      textStep("I've updated it."),
    ]),
    "+15550000001",
    "make it a 3",
  );
  assert.equal(result.reply, CLARIFY_REPLY);
});

const agitation = (store: Store, severity: 1 | 2 | 3 | null = 2) =>
  store.addObservation({
    caregiver: "+15550000001",
    domain: "agitation_aggression",
    severity,
    distress: null,
    quote: "agitated at dinner",
    observedPeriod: null,
  });

test("an update not stated in the latest message is rejected (no silent changes)", async () => {
  const store = new Store(null);
  const obs = await agitation(store);
  await runAgent(
    deps(store, [
      toolStep([
        {
          toolName: "update_observation",
          input: { observation_id: obs.id, caregiver_said: "it was more like a 3", severity: 3 },
        },
      ]),
      textStep("What happened?"),
    ]),
    "+15550000001",
    "Something amazing happened today",
  );
  assert.equal(obs.severity, 2);
  assert.equal(obs.revisions.length, 0);
});

test("skip declines at most one record per turn", async () => {
  const store = new Store(null);
  const obs = await agitation(store, null);
  const episode = await store.addLucidityEpisode({
    caregiver: "+15550000001",
    quote: "she said my name",
    observedPeriod: "today",
    duration: null,
    context: null,
    whatWasSaidOrDone: "said my name",
    afterState: null,
  });
  await runAgent(
    deps(store, [
      toolStep([
        {
          toolName: "update_lucidity_episode",
          input: { episode_id: episode.id, caregiver_said: "skip", followup_declined: true },
        },
        {
          toolName: "update_observation",
          input: { observation_id: obs.id, caregiver_said: "skip", followup_declined: true },
        },
      ]),
      textStep("No problem."),
    ]),
    "+15550000001",
    "Skip",
  );
  assert.equal(episode.followupDeclined, true);
  assert.equal(obs.followupDeclined, false);
});

test("a quote that isn't the caregiver's words is not saved", async () => {
  const store = new Store(null);
  await runAgent(
    deps(store, [
      toolStep([
        {
          toolName: "log_general",
          input: { topic: "activity_or_hobby", summary: "Enjoys chess.", quote: "he is a chess grandmaster" },
        },
      ]),
      textStep("Nice."),
    ]),
    "+15550000001",
    "he still loves gardening tho",
  );
  assert.equal(store.snapshot().notes.length, 0);
});

test("hobbies are saved as one note per activity with the caregiver's words", async () => {
  const store = new Store(null);
  await runAgent(
    deps(store, [
      toolStep([
        {
          toolName: "log_general",
          input: {
            topic: "activity_or_hobby",
            summary: "Still enjoys gardening (enjoyment; ability not mentioned).",
            quote: "He still loves gardening tho",
          },
        },
      ]),
      textStep("That's lovely."),
    ]),
    "+15550000001",
    "He still loves gardening tho",
  );
  const [note] = store.snapshot().notes;
  assert.equal(note?.topic, "activity_or_hobby");
});

test("the model is told when no one on the care team was notified", async () => {
  const store = new Store(null);
  const d = deps(store, [
    toolStep([{ toolName: "escalate_urgent", input: { reason: "very drowsy", quote: "hard to keep her awake" } }]),
    textStep("I'm here with you."),
  ]);
  await runAgent(d, "+15550000001", "she's coughing and it's hard to keep her awake today");
  const second = (d.llm.model as MockLanguageModelV4).doGenerateCalls[1]!;
  assert.match(JSON.stringify(second.prompt), /NO ONE was notified/);
});

test("the first step requires a tool call, and a skipped tool call falls back instead of failing", async () => {
  const store = new Store(null);
  const d = deps(store, [textStep("hi!"), textStep("Hi there!")]);
  const result = await runAgent(d, "+15550000001", "hi");
  const calls = (d.llm.model as MockLanguageModelV4).doGenerateCalls;
  assert.equal(calls[0]!.toolChoice?.type, "required");
  assert.notEqual(calls[1]!.toolChoice?.type, "required");
  assert.equal(result.reply, "Hi there!");
});

test("an invitation without the offer tool still records the offer", async () => {
  const store = new Store(null);
  const d = { ...deps(store, [noRecord(), textStep("Want to do a short 12-question check-in? Reply YES or NO.")]), questionnairesAvailable: true };
  await runAgent(d, "+15550000001", "Dad was up pacing again");
  assert.equal(store.caregiver("+15550000001").pendingOffer?.patientLabel, "Dad");
});

test("check-in invitation and patient label detection", () => {
  assert.ok(invitesCheckIn("There's a short check-in, about 5 minutes. Reply YES or NO."));
  assert.ok(!invitesCheckIn("Did he calm down? Reply yes or no."));
  assert.equal(guessPatientLabel(["my mom forgot my name"]), "Mom");
  assert.equal(guessPatientLabel(["he was up all night"]), null);
});
