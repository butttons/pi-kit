import type { Model, Api } from "@mariozechner/pi-ai";

/**
 * Configuration for a sub-agent task.
 * Each task defines a system prompt, user prompt, and optional model override.
 */
export type SubAgentTask = {
  name: string;
  systemPrompt: string;
  userPrompt: string;
  model?: Model<Api>;
  tools?: SubAgentTool[];
};

/**
 * Minimal tool definition for sub-agent use.
 * Subset of pi-ai Tool -- just enough for `complete()`.
 */
export type SubAgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
};

/**
 * Result from a sub-agent execution.
 */
export type SubAgentResult = {
  isSuccess: boolean;
  output: string;
  toolCallsMade: string[];
  model: string;
  error?: string;
};

/**
 * Configuration for the sub-agent system.
 */
export type SubAgentConfig = {
  /** Default model identifier for sub-agents: "provider/model-id" */
  defaultModel?: string;
};
