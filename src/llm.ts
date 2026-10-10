// Model connection. Any OpenAI-compatible provider works; switch by changing
// the three LLM_* variables in .env — no code changes needed.
//
//   LLM_BASE_URL=https://opencode.ai/zen/go/v1
//   LLM_API_KEY=<your key>
//   LLM_MODEL=glm-5.3
//   LLM_REASONING_EFFORT=low   (optional; default "low", "default" sends nothing)

import { createHash } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, generateText } from "ai";

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export interface LlmConfig {
  model: LanguageModel;
  modelId: string;
  baseURL: string;
  /** Per-request provider options (e.g. reasoning effort); pass to every call. */
  providerOptions: ProviderOptions;
  reasoningEffort: string | null;
}

const PROVIDER_NAME = "lucidity-llm";

/** Returns null (AI disabled) unless all three LLM_* variables are set. */
export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const baseURL = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const modelId = env.LLM_MODEL?.trim();
  if (!baseURL || !apiKey || !modelId) return null;

  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL,
    apiKey,
    // OpenCode asks clients to identify themselves rather than send a generic
    // SDK user agent, and rejects requests without a session id. This default
    // covers one-off calls; per-caregiver calls override it via sessionHeaders.
    headers: {
      "User-Agent": "lucidity/0.1 (HackNC 2026 prototype)",
      ...sessionHeaders("default"),
    },
  });

  // GLM's default reasoning is long and highly variable (7s to 60s+ per step
  // in testing); "low" answered the same caregiver message in ~2s.
  const effort = env.LLM_REASONING_EFFORT?.trim() || "low";
  const reasoningEffort = effort === "default" ? null : effort;
  const providerOptions: ProviderOptions = reasoningEffort ? { lucidityLlm: { reasoningEffort } } : {};

  return { model: provider(modelId), modelId, baseURL, providerOptions, reasoningEffort };
}

/**
 * Stable per-conversation session id for providers that want one (OpenCode
 * reads `x-opencode-session`). Hashed so the caregiver's phone number is
 * never sent to the model provider.
 */
export function sessionHeaders(caregiver: string): Record<string, string> {
  const id = createHash("sha256").update(`lucidity:${caregiver}`).digest("hex").slice(0, 24);
  return { "x-opencode-session": id };
}
