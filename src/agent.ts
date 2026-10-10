// The Intelligence step: one caregiver turn → LLM with structured tools → reply.
// Tools write to the Store; inputs are validated by zod before anything is saved.
// Invalid tool inputs are returned to the model as errors so it can retry.

import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { sessionHeaders, type LlmConfig } from "./llm.ts";
import { SYSTEM_PROMPT, contextBlock } from "./prompt.ts";
import { GENERAL_TOPICS, NPI_DOMAINS, type Store } from "./store.ts";

const MAX_STEPS = 4;
const TIMEOUT_MS = 60_000;

export interface AgentDeps {
  store: Store;
  llm: LlmConfig;
  /** Called when the model flags something urgent the keyword rules missed. */
  onEscalate: (caregiver: string, reason: string, quote: string) => Promise<void>;
  now?: () => Date;
}

export interface AgentResult {
  /** Text to send back; null when the model produced none. */
  reply: string | null;
  escalated: boolean;
  toolCalls: string[];
}

const quote = z.string().min(1).describe("The caregiver's exact words this record is based on.");
const observedPeriod = z
  .string()
  .nullish()
  .describe('Time period the caregiver described, e.g. "last night", "this week". null if not said.');
const nullableText = (description: string) => z.string().nullish().describe(`${description} null if not said.`);

function buildTools(deps: AgentDeps, caregiver: string, state: { escalated: boolean }) {
  const { store } = deps;
  return {
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
        "Fill in or correct severity/distress/period on an existing observation, or mark that the caregiver declined the follow-up. Omit fields that aren't changing.",
      inputSchema: z.object({
        observation_id: z.string(),
        severity: z.number().int().min(1).max(3).nullish(),
        distress: z.number().int().min(0).max(5).nullish(),
        observed_period: z.string().nullish(),
        followup_declined: z.boolean().nullish(),
      }),
      execute: async (input) => {
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
        "Add or correct details on an existing lucidity episode, or mark that the caregiver declined follow-ups. Omit fields that aren't changing.",
      inputSchema: z.object({
        episode_id: z.string(),
        duration: z.string().nullish(),
        context: z.string().nullish(),
        what_was_said_or_done: z.string().nullish(),
        after_state: z.string().nullish(),
        observed_period: z.string().nullish(),
        followup_declined: z.boolean().nullish(),
      }),
      execute: async (input) => {
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
        "Record other useful context: hobbies/activities (enjoyment vs ability), daily tasks, caregiver wellbeing, medical context, positive moments.",
      inputSchema: z.object({
        topic: z.enum(GENERAL_TOPICS),
        summary: z.string().min(1).describe("One plain sentence describing only what was reported."),
        quote,
        observed_period: observedPeriod,
      }),
      execute: async (input) => {
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
        "Flag a possible emergency or something needing a doctor soon. Lucidity sends pre-approved safety guidance and alerts the care team.",
      inputSchema: z.object({
        reason: z.string().min(1).describe("Short reason, e.g. 'possible fall with injury'."),
        quote,
      }),
      execute: async (input) => {
        if (!state.escalated) {
          state.escalated = true;
          await deps.onEscalate(caregiver, input.reason, input.quote);
        }
        return { ok: true, note: "Safety guidance is being sent by Lucidity. Keep your reply short and supportive." };
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
  const state = { escalated: false };

  const messages: ModelMessage[] = deps.store
    .recentHistory(caregiver)
    .map((turn) => ({ role: turn.role, content: turn.text }));
  messages.push({ role: "user", content: text });

  const result = await generateText({
    model: deps.llm.model,
    system: [SYSTEM_PROMPT, contextBlock(now, deps.store.recentRecords(caregiver)), options.note]
      .filter(Boolean)
      .join("\n\n"),
    messages,
    tools: buildTools(deps, caregiver, state),
    stopWhen: stepCountIs(MAX_STEPS),
    maxRetries: 1,
    headers: sessionHeaders(caregiver),
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const toolCalls = result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
  const reply = result.text.trim() || null;
  return { reply, escalated: state.escalated, toolCalls };
}
