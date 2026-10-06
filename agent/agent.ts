import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent, defineDynamic } from "eve";
import { chatgpt } from "eve/models/openai";
import { timedModelFetch } from "./lib/model-timeout";

type AiProvider = "chatgpt" | "openrouter" | "ollama";

function aiProvider(): AiProvider {
  const value = process.env.BEEBLIO_AI_PROVIDER?.trim().toLowerCase() || "chatgpt";
  if (value === "chatgpt" || value === "openrouter" || value === "ollama") return value;
  throw new Error("BEEBLIO_AI_PROVIDER must be chatgpt, openrouter, or ollama");
}

// Direct OpenRouter/Ollama models do not provide Eve with context-window metadata.
// Configure the size for the model selected in OPENROUTER_MODEL_ID.
function openRouterModelConfig() {
  const modelId = process.env.OPENROUTER_MODEL_ID?.trim();
  const contextWindow = Number(process.env.OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS);
  if (!modelId) throw new Error("OPENROUTER_MODEL_ID is not configured");
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    throw new Error("OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS must be a positive integer for the selected model");
  }
  return { modelId, contextWindow };
}

const provider = aiProvider();

const model = provider === "chatgpt"
  ? chatgpt(process.env.CHATGPT_MODEL_ID?.trim() || "gpt-5.6-sol")
  : defineDynamic({
      events: {
        "step.started": async () => {
          const fetch = timedModelFetch();
          const openrouter = createOpenRouter({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: process.env.OPENROUTER_BASE_URL?.trim() || undefined,
            fetch,
          });
          const { modelId, contextWindow } = openRouterModelConfig();
          return { model: openrouter(modelId), modelContextWindowTokens: contextWindow };
        },
      },
    });

export default defineAgent({
  // Default to the user's existing ChatGPT subscription for fast, reliable
  // local research-agent use with no separate API billing. Set
  // BEEBLIO_AI_PROVIDER=ollama or openrouter to use the previous path.
  model,
  reasoning: provider === "chatgpt" ? "low" : "none",
  limits: {
    maxInputTokensPerSession: 5_000_000,
    maxOutputTokensPerSession: 200_000,
  },
  build: {
    externalDependencies: ["better-sqlite3", "sharp"],
  },
});
