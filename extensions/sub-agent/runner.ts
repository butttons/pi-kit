/**
 * Sub-agent runner.
 *
 * Executes a sub-agent task in an isolated context using the pi-ai
 * `complete()` function directly. Handles the tool-call loop internally
 * so the main agent context is never polluted.
 */

import { complete, type Message, type ToolCall, type Tool, type Api, type Model } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import type { SubAgentTool, SubAgentResult } from "./types.js";

const MAX_TURNS = 20;

export async function runSubAgent({
  systemPrompt,
  userPrompt,
  model,
  apiKey,
  tools,
  signal,
  onUpdate,
}: {
  systemPrompt: string;
  userPrompt: string;
  model: Model<Api>;
  apiKey: string;
  tools?: SubAgentTool[];
  signal?: AbortSignal;
  onUpdate?: (params: { status: string }) => void;
}): Promise<SubAgentResult> {
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: userPrompt }],
      timestamp: Date.now(),
    },
  ];

  // Cast parameters to TSchema -- they are plain JSON Schema objects which
  // the providers serialize identically. TypeBox's TSchema adds runtime
  // symbols that aren't needed for the wire format.
  const piTools: Tool[] | undefined = tools?.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown as TSchema,
  }));

  const toolCallsMade: string[] = [];
  let turns = 0;

  while (turns < MAX_TURNS) {
    turns++;

    if (signal?.aborted) {
      return {
        isSuccess: false,
        output: "",
        toolCallsMade,
        model: model.id,
        error: "Aborted",
      };
    }

    onUpdate?.({ status: `Turn ${turns}...` });

    const response = await complete(model, {
      systemPrompt,
      messages,
      tools: piTools,
    }, {
      apiKey,
      signal,
    });

    messages.push(response);

    if (response.stopReason === "error") {
      return {
        isSuccess: false,
        output: response.errorMessage ?? "Unknown LLM error",
        toolCallsMade,
        model: model.id,
        error: response.errorMessage,
      };
    }

    if (response.stopReason === "aborted") {
      return {
        isSuccess: false,
        output: "",
        toolCallsMade,
        model: model.id,
        error: "Aborted",
      };
    }

    // Extract tool calls from the response
    const pendingToolCalls = response.content.filter(
      (c): c is ToolCall => c.type === "toolCall",
    );

    if (pendingToolCalls.length === 0 || response.stopReason !== "toolUse") {
      // No tool calls -- extract final text output
      const textParts = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text);

      return {
        isSuccess: true,
        output: textParts.join("\n"),
        toolCallsMade,
        model: model.id,
      };
    }

    // Execute each tool call and append results
    for (const toolCall of pendingToolCalls) {
      toolCallsMade.push(toolCall.name);
      const tool = tools?.find((t) => t.name === toolCall.name);

      if (!tool) {
        messages.push({
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Unknown tool: ${toolCall.name}` }],
          isError: true,
          timestamp: Date.now(),
        });
        continue;
      }

      onUpdate?.({ status: `Calling ${toolCall.name}...` });

      try {
        const result = await tool.execute(toolCall.arguments);
        messages.push({
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: result }],
          isError: false,
          timestamp: Date.now(),
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        messages.push({
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Tool error: ${errorMessage}` }],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  // Exceeded max turns
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const fallbackText = lastAssistant
    ? lastAssistant.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
    : "";

  return {
    isSuccess: false,
    output: fallbackText || "Sub-agent exceeded maximum turns without completing.",
    toolCallsMade,
    model: model.id,
    error: `Exceeded ${MAX_TURNS} turn limit`,
  };
}
