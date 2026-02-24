/**
 * Sub-agent extension
 *
 * Runs commands in isolated sub-agent contexts using a configurable model.
 * The main agent context is never polluted with sub-agent internals --
 * only the final result is injected back.
 *
 * Currently supports:
 *   /recall <query>    -- search past sessions via a sub-agent
 *
 * Configuration (via pi appendEntry persisted state):
 *   /sub-agent model <provider/model-id>   -- set default sub-agent model
 *   /sub-agent model                       -- show current model
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { runSubAgent } from "./runner.js";
import { buildRecallPrompt, RECALL_SYSTEM_PROMPT } from "./tasks/recall.js";
import type { SubAgentConfig } from "./types.js";

const STATE_KEY = "sub-agent-config";

/** Default model when nothing is configured. */
const FALLBACK_MODEL = { provider: "anthropic", id: "claude-haiku-4-5" };

function parseArgs({ raw }: { raw: string }): { query: string; isCompact: boolean } {
  const isCompact = /--compact\b/.test(raw);
  const query = raw.replace(/--compact\b/, "").trim();
  return { query, isCompact };
}

async function resolveModel({
  config,
  ctx,
}: {
  config: SubAgentConfig;
  ctx: ExtensionContext;
}): Promise<Model<Api> | null> {
  if (config.defaultModel) {
    const [provider, ...rest] = config.defaultModel.split("/");
    const modelId = rest.join("/");
    if (provider && modelId) {
      const found = ctx.modelRegistry.find(provider, modelId);
      if (found) return found;
    }
  }

  // Fall back to built-in default
  const fallback = ctx.modelRegistry.find(FALLBACK_MODEL.provider, FALLBACK_MODEL.id);
  return fallback ?? null;
}

export default function subAgent(pi: ExtensionAPI): void {
  let config: SubAgentConfig = {};

  // Restore persisted config from session
  pi.on("session_start", async (_event, ctx) => {
    config = {};
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === STATE_KEY) {
        config = (entry.data as SubAgentConfig) ?? {};
      }
    }
  });

  // -------------------------------------------------------------------
  // /sub-agent command -- configure the sub-agent system
  // -------------------------------------------------------------------
  pi.registerCommand("sub-agent", {
    description: "Configure sub-agent settings. Usage: /sub-agent model [provider/model-id]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0];

      if (subcommand === "model") {
        const modelSpec = parts[1];

        if (!modelSpec) {
          const current = config.defaultModel ?? `${FALLBACK_MODEL.provider}/${FALLBACK_MODEL.id} (default)`;
          ctx.ui.notify(`Sub-agent model: ${current}`, "info");
          return;
        }

        // Validate the model exists
        const [provider, ...rest] = modelSpec.split("/");
        const modelId = rest.join("/");
        if (!provider || !modelId) {
          ctx.ui.notify("Format: provider/model-id (e.g. anthropic/claude-haiku-4-5)", "error");
          return;
        }

        const found = ctx.modelRegistry.find(provider, modelId);
        if (!found) {
          ctx.ui.notify(`Model not found: ${modelSpec}`, "error");
          return;
        }

        config = { ...config, defaultModel: modelSpec };
        pi.appendEntry(STATE_KEY, config);
        ctx.ui.notify(`Sub-agent model set to: ${modelSpec}`, "info");
        return;
      }

      ctx.ui.notify("Usage: /sub-agent model [provider/model-id]", "error");
    },
  });

  // -------------------------------------------------------------------
  // /recall command -- search past sessions via sub-agent
  // -------------------------------------------------------------------
  pi.registerCommand("recall", {
    description: "Search past sessions via sub-agent: /recall [--compact] <query>",
    handler: async (args, ctx) => {
      const { query, isCompact } = parseArgs({ raw: args });

      if (!query) {
        ctx.ui.notify("Usage: /recall [--compact] <query>", "error");
        return;
      }

      const model = await resolveModel({ config, ctx });
      if (!model) {
        ctx.ui.notify("No model available for sub-agent. Set one with /sub-agent model <provider/model-id>", "error");
        return;
      }

      const apiKey = await ctx.modelRegistry.getApiKey(model);
      if (!apiKey) {
        ctx.ui.notify(`No API key for model: ${model.provider}/${model.id}`, "error");
        return;
      }

      const { userPrompt, tools } = buildRecallPrompt({
        cwd: ctx.cwd,
        query,
        isCompact,
      });

      if (!ctx.hasUI) {
        // Non-interactive: run inline and inject result
        const result = await runSubAgent({
          systemPrompt: RECALL_SYSTEM_PROMPT,
          userPrompt,
          model,
          apiKey,
          tools,
        });

        pi.sendMessage({
          customType: "sub-agent-recall",
          content: result.output || "No results found.",
          display: true,
          details: {
            query,
            isSuccess: result.isSuccess,
            model: result.model,
            toolCallsMade: result.toolCallsMade,
          },
        });
        return;
      }

      // Interactive: show loader UI while sub-agent runs
      const result = await ctx.ui.custom<{
        output: string;
        isSuccess: boolean;
        modelUsed: string;
        toolCallsMade: string[];
      } | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `Searching sessions via ${model.provider}/${model.id}...`,
        );
        loader.onAbort = () => done(null);

        const doRun = async () => {
          const subResult = await runSubAgent({
            systemPrompt: RECALL_SYSTEM_PROMPT,
            userPrompt,
            model,
            apiKey,
            tools,
            signal: loader.signal,
          });

          return {
            output: subResult.output,
            isSuccess: subResult.isSuccess,
            modelUsed: subResult.model,
            toolCallsMade: subResult.toolCallsMade,
          };
        };

        doRun()
          .then(done)
          .catch((err) => {
            console.error("Sub-agent recall failed:", err);
            done(null);
          });

        return loader;
      });

      if (result === null) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      const modelLabel = `${model.provider}/${result.modelUsed}`;
      const header = result.isSuccess
        ? `Recall results (via ${modelLabel}):`
        : `Recall failed (via ${modelLabel}):`;

      pi.sendMessage({
        customType: "sub-agent-recall",
        content: `${header}\n\n${result.output || "No results found."}`,
        display: true,
        details: {
          query,
          isSuccess: result.isSuccess,
          model: result.modelUsed,
          toolCallsMade: result.toolCallsMade,
        },
      });
    },
  });
}
