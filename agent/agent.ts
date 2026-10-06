import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent, defineDynamic } from "eve";
import { timedModelFetch } from "./lib/model-timeout";

// Direct OpenRouter models do not provide Eve with context-window metadata.
// Configure the size for the model selected in OPENROUTER_MODEL_ID.
function mainModelConfig() {
  const modelId = process.env.OPENROUTER_MODEL_ID?.trim();
  const contextWindow = Number(process.env.OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS);
  if (!modelId) throw new Error("OPENROUTER_MODEL_ID is not configured");
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    throw new Error("OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS must be a positive integer for the selected model");
  }
  return { modelId, contextWindow };
}

export default defineAgent({
  // A dynamic model has no compiled fallback in current eve: the resolver must
  // return a concrete model for every step, so non-BYOK turns resolve to the
  // system OpenRouter model here.
  model: defineDynamic({
    events: {
      "step.started": async () => {
        const fetch = timedModelFetch();
        const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL?.trim() || undefined, fetch });
        const { modelId, contextWindow } = mainModelConfig();
        return { model: openrouter(modelId), modelContextWindowTokens: contextWindow };
      },
    },
  }),
  reasoning: "none",
  limits: {
    // Input consumption re-bills the full context every model call, so it grows
    // far faster than context size; 5M keeps the continuation prompt out of
    // legitimate long runs while still stopping defective ones. Output must be
    // sized alongside it: approving either window resets both, so a tight
    // output cap resurfaces the dialog once input approvals become rare.
    maxInputTokensPerSession: 5_000_000,
    maxOutputTokensPerSession: 200_000,
  },
  build: {
    // Keep the sandbox/storage SDKs external instead of bundling them.
    externalDependencies: ["better-sqlite3", "sharp"],
  },
});
