// One-off check that the configured model is reachable and makes clean tool
// calls. Does not touch iMessage. Run with: npm run llm:check

import { APICallError, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { loadLlmConfig, sessionHeaders } from "../llm.ts";

const llm = loadLlmConfig();
if (!llm) {
  const missing = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].filter((name) => !process.env[name]?.trim());
  console.error(`✗ Missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Model:    ${llm.modelId}`);
console.log(`Endpoint: ${llm.baseURL}`);

let calledWith: unknown = null;
const started = Date.now();
try {
  const result = await generateText({
    model: llm.model,
    system: "You record caregiver observations with tools, then reply in one short sentence.",
    prompt: "My dad was up pacing the hallway all night again.",
    tools: {
      log_observation: tool({
        description: "Record a behavior the caregiver reported.",
        inputSchema: z.object({
          domain: z.enum(["nighttime_behaviors", "aberrant_motor_behavior", "agitation_aggression", "other"]),
          quote: z.string().describe("The caregiver's exact words."),
        }),
        execute: async (input) => {
          calledWith = input;
          return { ok: true };
        },
      }),
    },
    stopWhen: stepCountIs(3),
    maxRetries: 0,
    headers: sessionHeaders("llm-check"),
    abortSignal: AbortSignal.timeout(60_000),
  });

  console.log(`Latency:  ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`Tokens:   ${result.totalUsage.inputTokens ?? "?"} in / ${result.totalUsage.outputTokens ?? "?"} out`);
  console.log(`Reply:    ${result.text.trim() || "(none)"}`);
  if (calledWith) {
    console.log(`✓ Tool call OK: ${JSON.stringify(calledWith)}`);
  } else {
    console.error("✗ The model replied but did not call the tool. Tool calling may be unreliable with this model.");
    process.exit(1);
  }
} catch (err) {
  if (APICallError.isInstance(err)) {
    console.error(`✗ API error ${err.statusCode ?? ""}: ${err.message}`);
    if (err.statusCode === 401 || err.statusCode === 403) console.error("  Check LLM_API_KEY.");
    if (err.statusCode === 404) console.error("  Check LLM_BASE_URL and LLM_MODEL.");
  } else {
    console.error("✗ Request failed:", err instanceof Error ? err.message : err);
  }
  process.exit(1);
}
