// The Intelligence step: one caregiver turn → LLM with structured tools → reply.
// Tools write to the Store; inputs are validated by zod before anything is saved.
// Invalid tool inputs are returned to the model as errors so it can retry.
//
// Code-level guards (instructions alone weren't enough with GLM in testing):
// - The first step must call a tool (a record tool or no_record_needed), so the
//   model explicitly decides whether a message contains something to save.
// - Quotes must be the caregiver's real words; updates must be stated in the
//   caregiver's latest message, so earlier ambiguous answers can't be
//   "resolved" silently.
// - "Skip" can decline follow-ups on at most one record per turn.
// - A reply may not claim a save that didn't happen.

import { ToolChoiceViolationError, generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { sessionHeaders, type LlmConfig } from "./llm.ts";
import { SYSTEM_PROMPT, contextBlock } from "./prompt.ts";
import { assessmentContext, recordOffer } from "./questionnaire.ts";
import { GENERAL_TOPICS, NPI_DOMAINS, type Store } from "./store.ts";

const MAX_STEPS = 4;
const DEFAULT_TIMEOUT_MS = 90_000;

export interface AgentDeps {
  store: Store;
  llm: LlmConfig;
  /**
   * Called when the model flags something urgent the keyword rules missed.
   * Resolves to whether a person on the care team was actually notified.
   */
  onEscalate: (caregiver: string, reason: string, quote: string) => Promise<boolean>;
  now?: () => Date;
  /** Whole-turn budget across all steps and retries. */
  timeoutMs?: number;
  /** Per-step diagnostics (tools called, timing, tokens). */
  onStep?: (info: StepInfo) => void;
  /** Whether questionnaire wording is installed, so check-ins can be offered. */
  questionnairesAvailable?: boolean;
}

export interface StepInfo {
  step: number;
  ms: number;
  finishReason: string;
  tools: string[];
  outputTokens: number | undefined;
  reasoningChars: number;
}

export interface AgentResult {
  /** Text to send back; null when the model produced none. */
  reply: string | null;
  escalated: boolean;
  toolCalls: string[];
}

const quote = z
  .string()
  .min(1)
  .describe("The caregiver's exact words this record is based on, copied from their messages.");
const caregiverSaid = z
  .string()
  .min(1)
  .describe("The caregiver's exact words in their LATEST message that state this change (e.g. \"it was a 2\", \"skip\").");
const observedPeriod = z
  .string()
  .nullish()
  .describe('Time period the caregiver described, e.g. "last night", "this week". null if not said.');
const nullableText = (description: string) => z.string().nullish().describe(`${description} null if not said.`);

interface TurnState {
  escalated: boolean;
  careTeamNotified: boolean;
  declinedThisTurn: boolean;
  /** The caregiver's latest message (this turn). */
  latest: string;
  /** Recent caregiver messages, including the latest. */
  recentCaregiverText: string[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `words` appears (ignoring case/punctuation) in one of `texts`. */
export function saidIn(words: string, texts: string[]): boolean {
  const needle = normalize(words);
  return needle.length > 0 && texts.some((t) => normalize(t).includes(needle));
}

const notFromCaregiver = (q: string) => ({
  ok: false,
  error: `Not saved: "${q}" isn't in the caregiver's messages. Use their exact words as the quote.`,
});
const notInLatest = (q: string) => ({
  ok: false,
  error: `Not saved: "${q}" isn't in the caregiver's latest message. Only update a record when their latest message clearly says so; if it's unclear, ask instead.`,
});
const alreadyDeclined = {
  ok: false,
  error: "Not saved: only mark the one record whose question the caregiver just skipped.",
};

function buildTools(deps: AgentDeps, caregiver: string, state: TurnState) {
  const { store } = deps;
  const fromCaregiver = (q: string) => saidIn(q, state.recentCaregiverText);
  const inLatest = (q: string) => saidIn(q, [state.latest]);
  const claimDecline = (declined: boolean | null | undefined) => {
    if (!declined) return true;
    if (state.declinedThisTurn) return false;
    state.declinedThisTurn = true;
    return true;
  };

  return {
    offer_questionnaire: tool({
      description:
        "Offer the caregiver the NPI-Q check-in (12 standard questions about the past month, about 5 minutes). Call this, then ask in your reply whether they'd like to do it, ending with 'Reply YES or NO.' Lucidity takes over and asks the questions if they say yes.",
      inputSchema: z.object({
        patient_label: z.string().min(1).describe('How the caregiver refers to the patient, e.g. "Dad", "Mom", "my husband".'),
        reason: z.string().min(1).describe("The cue that prompted the offer, e.g. 'several evening behavior reports this week'."),
      }),
      execute: async (input) => {
        if (!deps.questionnairesAvailable) return { ok: false, error: "Check-ins aren't available right now. Don't offer one." };
        const result = await recordOffer(store, caregiver, input.patient_label, deps.now?.() ?? new Date());
        return result.ok
          ? { ok: true, note: "Offer recorded. In your reply, briefly invite them (about 12 questions, ~5 minutes, about the past month, shared with the care team) and end with 'Reply YES or NO.'" }
          : { ok: false, error: `Don't offer it. ${result.reason}` };
      },
    }),

    no_record_needed: tool({
      description:
        "Call this ONLY when the latest message has nothing new to record: greetings, thanks, small talk, or a question to you. Anything about the person's behavior, mood, activities, abilities, health, routines, or the caregiver's own wellbeing must be recorded with another tool instead.",
      inputSchema: z.object({ reason: z.string().min(1) }),
      execute: async () => ({ ok: true }),
    }),

    log_npi_observation: tool({
      description: "Record a behavioral/psychological symptom the caregiver reported (one NPI-Q domain).",
      inputSchema: z.object({
        domain: z.enum(NPI_DOMAINS),
        severity: z.number().int().min(1).max(3).nullish().describe("1 mild, 2 moderate, 3 severe. null if not said."),
        distress: z
          .number()
          .int()
          .min(0)
          .max(5)
          .nullish()
          .describe("Caregiver's distress 0 (none) to 5 (extreme). null if not said."),
        quote,
        observed_period: observedPeriod,
      }),
      execute: async (input) => {
        if (!fromCaregiver(input.quote)) return notFromCaregiver(input.quote);
        const record = await store.addObservation({
          caregiver,
          domain: input.domain,
          severity: (input.severity ?? null) as 1 | 2 | 3 | null,
          distress: (input.distress ?? null) as 0 | 1 | 2 | 3 | 4 | 5 | null,
          quote: input.quote,
          observedPeriod: input.observed_period ?? null,
        });
        return { ok: true, id: record.id };
      },
    }),

    update_observation: tool({
      description:
        "Fill in or correct severity/distress/period on an existing observation, or mark that the caregiver skipped ITS follow-up question. Only when the caregiver's latest message says so. Omit fields that aren't changing.",
      inputSchema: z.object({
        observation_id: z.string(),
        caregiver_said: caregiverSaid,
        severity: z.number().int().min(1).max(3).nullish(),
        distress: z.number().int().min(0).max(5).nullish(),
        observed_period: z.string().nullish(),
        followup_declined: z.boolean().nullish(),
      }),
      execute: async (input) => {
        if (!inLatest(input.caregiver_said)) return notInLatest(input.caregiver_said);
        if (!claimDecline(input.followup_declined)) return alreadyDeclined;
        const record = await store.updateObservation(caregiver, input.observation_id, {
          severity: (input.severity ?? undefined) as 1 | 2 | 3 | undefined,
          distress: (input.distress ?? undefined) as 0 | 1 | 2 | 3 | 4 | 5 | undefined,
          observedPeriod: input.observed_period ?? undefined,
          followupDeclined: input.followup_declined ?? undefined,
        });
        return record ? { ok: true, id: record.id } : { ok: false, error: "No such observation for this caregiver." };
      },
    }),

    log_lucidity_episode: tool({
      description: "Record a moment of unexpected clarity (paradoxical lucidity) the caregiver described.",
      inputSchema: z.object({
        quote,
        observed_period: observedPeriod,
        duration: nullableText("How long it lasted."),
        context: nullableText("What was happening right before (time of day, visitors, music, environment)."),
        what_was_said_or_done: nullableText("What the person said or did."),
        after_state: nullableText("How they were afterward."),
      }),
      execute: async (input) => {
        if (!fromCaregiver(input.quote)) return notFromCaregiver(input.quote);
        const record = await store.addLucidityEpisode({
          caregiver,
          quote: input.quote,
          observedPeriod: input.observed_period ?? null,
          duration: input.duration ?? null,
          context: input.context ?? null,
          whatWasSaidOrDone: input.what_was_said_or_done ?? null,
          afterState: input.after_state ?? null,
        });
        return { ok: true, id: record.id };
      },
    }),

    update_lucidity_episode: tool({
      description:
        "Add or correct details on an existing lucidity episode, or mark that the caregiver skipped ITS follow-up question. Only when the caregiver's latest message says so. Omit fields that aren't changing.",
      inputSchema: z.object({
        episode_id: z.string(),
        caregiver_said: caregiverSaid,
        duration: z.string().nullish(),
        context: z.string().nullish(),
        what_was_said_or_done: z.string().nullish(),
        after_state: z.string().nullish(),
        observed_period: z.string().nullish(),
        followup_declined: z.boolean().nullish(),
      }),
      execute: async (input) => {
        if (!inLatest(input.caregiver_said)) return notInLatest(input.caregiver_said);
        if (!claimDecline(input.followup_declined)) return alreadyDeclined;
        const record = await store.updateLucidityEpisode(caregiver, input.episode_id, {
          duration: input.duration ?? undefined,
          context: input.context ?? undefined,
          whatWasSaidOrDone: input.what_was_said_or_done ?? undefined,
          afterState: input.after_state ?? undefined,
          observedPeriod: input.observed_period ?? undefined,
          followupDeclined: input.followup_declined ?? undefined,
        });
        return record ? { ok: true, id: record.id } : { ok: false, error: "No such episode for this caregiver." };
      },
    }),

    log_general: tool({
      description:
        "Record other useful context: each hobby/activity (whether they still enjoy it vs. still can do it, and any reason given), daily tasks and abilities, caregiver wellbeing, medical context, positive moments. One note per activity.",
      inputSchema: z.object({
        topic: z.enum(GENERAL_TOPICS),
        summary: z.string().min(1).describe("One plain sentence describing only what was reported."),
        quote,
        observed_period: observedPeriod,
      }),
      execute: async (input) => {
        if (!fromCaregiver(input.quote)) return notFromCaregiver(input.quote);
        const record = await store.addNote({
          caregiver,
          topic: input.topic,
          summary: input.summary,
          quote: input.quote,
          observedPeriod: input.observed_period ?? null,
        });
        return { ok: true, id: record.id };
      },
    }),

    escalate_urgent: tool({
      description:
        "Flag a possible emergency or something needing a doctor soon. Lucidity sends pre-approved safety guidance itself and saves an alert for the care team.",
      inputSchema: z.object({
        reason: z.string().min(1).describe("Short reason, e.g. 'possible fall with injury'."),
        quote,
      }),
      execute: async (input) => {
        if (!state.escalated) {
          state.escalated = true;
          state.careTeamNotified = await deps.onEscalate(caregiver, input.reason, input.quote);
        }
        return {
          ok: true,
          care_team_notified: state.careTeamNotified,
          note: state.careTeamNotified
            ? "Safety guidance was sent and a care-team member was notified. Keep your reply short and supportive."
            : "Safety guidance was sent. NO ONE was notified in real time; the alert is only saved for later review. Do not say the care team was alerted or is aware. Keep your reply short and supportive.",
        };
      },
    }),
  };
}

export async function runAgent(
  deps: AgentDeps,
  caregiver: string,
  text: string,
  options: { note?: string } = {},
): Promise<AgentResult> {
  const now = deps.now?.() ?? new Date();
  const history = deps.store.recentHistory(caregiver);
  const state: TurnState = {
    escalated: false,
    careTeamNotified: false,
    declinedThisTurn: false,
    latest: text,
    recentCaregiverText: [...history.filter((t) => t.role === "user").map((t) => t.text).slice(-6), text],
  };

  const messages: ModelMessage[] = history.map((turn) => ({ role: turn.role, content: turn.text }));
  messages.push({ role: "user", content: text });

  const checkIns = deps.questionnairesAvailable
    ? `# Check-ins\n${assessmentContext(deps.store, caregiver, deps.store.caregiver(caregiver), now)}`
    : "# Check-ins\n- Not available; don't offer one.";
  const system = [SYSTEM_PROMPT, contextBlock(now, deps.store.recentRecords(caregiver)), checkIns, options.note]
    .filter(Boolean)
    .join("\n\n");
  const tools = buildTools(deps, caregiver, state);
  const abortSignal = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let stepCount = 0;
  let stepStarted = Date.now();

  const generateOnce = (extraSystem: string | undefined, requireTool: boolean) =>
    generateText({
      model: deps.llm.model,
      system: extraSystem ? `${system}\n\n${extraSystem}` : system,
      messages,
      tools,
      providerOptions: deps.llm.providerOptions,
      stopWhen: stepCountIs(MAX_STEPS),
      // Step 1 must call a tool (a record tool or no_record_needed).
      prepareStep: ({ stepNumber }) => (requireTool && stepNumber === 0 ? { toolChoice: "required" as const } : {}),
      maxRetries: 1,
      headers: sessionHeaders(caregiver),
      abortSignal,
      onStepFinish: (step) => {
        const at = Date.now();
        deps.onStep?.({
          step: ++stepCount,
          ms: at - stepStarted,
          finishReason: step.finishReason,
          tools: step.toolCalls.map((call) => call.toolName),
          outputTokens: step.usage.outputTokens,
          reasoningChars: step.reasoningText?.length ?? 0,
        });
        stepStarted = at;
      },
    });

  // If the model ignores the required tool call, retry once without forcing it
  // rather than failing the whole turn.
  const generate = async (extraSystem?: string) => {
    try {
      return await generateOnce(extraSystem, true);
    } catch (err) {
      if (!ToolChoiceViolationError.isInstance(err)) throw err;
      deps.onStep?.({ step: ++stepCount, ms: 0, finishReason: "retry:no-tool-call", tools: [], outputTokens: 0, reasoningChars: 0 });
      return generateOnce(extraSystem, false);
    }
  };

  let result = await generate();
  const allSteps = [...result.steps];

  // Safety net: the reply must never claim a save that didn't happen.
  if (claimsSave(result.text) && !savedSomething(allSteps)) {
    deps.onStep?.({ step: ++stepCount, ms: 0, finishReason: "retry:unsaved-claim", tools: [], outputTokens: 0, reasoningChars: 0 });
    result = await generate(UNSAVED_CLAIM_NOTE);
    allSteps.push(...result.steps);
    if (claimsSave(result.text) && !savedSomething(allSteps)) {
      return { reply: CLARIFY_REPLY, escalated: state.escalated, toolCalls: toolNames(allSteps) };
    }
  }

  const reply = result.text.trim() || null;

  // Safety net: the model sometimes invites a check-in without calling
  // offer_questionnaire. Record the offer so the caregiver's YES starts it.
  const caregiverState = deps.store.caregiver(caregiver);
  if (reply && deps.questionnairesAvailable && invitesCheckIn(reply) && !caregiverState.pendingOffer) {
    const label =
      caregiverState.patientLabel ?? guessPatientLabel([...state.recentCaregiverText, reply]) ?? "your loved one";
    const offered = await recordOffer(deps.store, caregiver, label, now);
    deps.onStep?.({ step: ++stepCount, ms: 0, finishReason: `offer-recorded:${offered.ok}`, tools: [], outputTokens: 0, reasoningChars: 0 });
  }

  return { reply, escalated: state.escalated, toolCalls: toolNames(allSteps) };
}

/** True when a reply invites the caregiver to start a check-in. */
export function invitesCheckIn(reply: string): boolean {
  return /reply yes or no/i.test(reply) && /check-?\s?in|questionnaire|questions/i.test(reply);
}

const RELATIONS: Record<string, string> = {
  dad: "Dad", father: "Dad", mom: "Mom", mother: "Mom", husband: "your husband", wife: "your wife",
  grandpa: "Grandpa", grandfather: "Grandpa", grandma: "Grandma", grandmother: "Grandma",
};

/** How the caregiver refers to the patient ("Dad"), from their messages. */
export function guessPatientLabel(texts: string[]): string | null {
  for (const text of [...texts].reverse()) {
    const match = text.toLowerCase().match(/\b(dad|father|mom|mother|husband|wife|grandpa|grandfather|grandma|grandmother)\b/);
    if (match) return RELATIONS[match[1]!]!;
  }
  return null;
}

const WRITE_TOOLS = new Set([
  "log_npi_observation",
  "update_observation",
  "log_lucidity_episode",
  "update_lucidity_episode",
  "log_general",
]);

// "I've updated that", "I have noted it", "I corrected", "saved that"…
const SAVE_CLAIM =
  /\b(i'?ve|i have|i|i'll|i will)\s+(just\s+|also\s+|now\s+)?(noted|saved|logged|recorded|updated|corrected|changed|added|adjusted|fixed)\b/i;

export function claimsSave(text: string): boolean {
  return SAVE_CLAIM.test(text.replace(/[\u2018\u2019]/g, "'"));
}

type Steps = Awaited<ReturnType<typeof generateText>>["steps"];

function toolNames(steps: Steps): string[] {
  return steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
}

function savedSomething(steps: Steps): boolean {
  return steps.some((step) =>
    step.toolResults.some(
      (r) => WRITE_TOOLS.has(r.toolName) && (r.output as { ok?: boolean } | undefined)?.ok === true,
    ),
  );
}

const UNSAVED_CLAIM_NOTE =
  "Your previous draft said something was saved or updated, but no record tool was called, so nothing was saved. Redo your reply: if it is clear which record and field the caregiver means, call the right tool now; if it is not clear (e.g. severity vs. distress, or which symptom), ask one short clarifying question and do not claim anything was saved.";

export const CLARIFY_REPLY =
  "Just so I record this correctly: which detail should I change? For example, how intense it was (1–3), or how much it stressed you (0–5)?";
