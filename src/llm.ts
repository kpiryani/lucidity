// Model connection. Any OpenAI-compatible provider works; switch by changing
// the three LLM_* variables in .env — no code changes needed.
//
//   LLM_BASE_URL=https://opencode.ai/zen/go/v1
//   LLM_API_KEY=<your key>
//   LLM_MODEL=glm-5.3

import { createHash } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export interface LlmConfig {
  model: LanguageModel;
  modelId: string;
  baseURL: string;
}

/** Returns null (AI disabled) unless all three LLM_* variables are set. */
export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const baseURL = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const modelId = env.LLM_MODEL?.trim();
  if (!baseURL || !apiKey || !modelId) return null;

  const provider = createOpenAICompatible({
    name: "lucidity-llm",
    baseURL,
    apiKey,
    // OpenCode asks clients to identify themselves rather than send a generic
    // SDK user agent.
    headers: { "User-Agent": "lucidity/0.1 (HackNC 2026 prototype)" },
  });
  return { model: provider(modelId), modelId, baseURL };
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
