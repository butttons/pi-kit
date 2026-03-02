/**
 * Pencil MCP extension for pi.
 *
 * Discovers Pencil MCP tools synchronously at load time (required by
 * pi's tool registration model), then lazily spawns the async MCP
 * client on first tool call.
 *
 * The server instructions are injected into the system prompt so the
 * model knows how to use .pen files correctly.
 *
 * Configuration (env vars):
 *   PENCIL_MCP_BINARY  -- path to the MCP server binary
 *     default: /Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64
 *   PENCIL_MCP_ARGS    -- comma-separated args for the binary
 *     default: --app,desktop
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type TObject, type TProperties } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { spawnSync } from "node:child_process";
import { createMcpClient, type McpClient } from "./mcp-client.js";

const DEFAULT_BINARY =
  "/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64";
const DEFAULT_ARGS = ["--app", "desktop"];

function getConfig(): { binary: string; args: string[] } {
  const binary = process.env.PENCIL_MCP_BINARY ?? DEFAULT_BINARY;
  const argsRaw = process.env.PENCIL_MCP_ARGS;
  const args = argsRaw ? argsRaw.split(",").map((a) => a.trim()) : DEFAULT_ARGS;
  return { binary, args };
}

type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Discover tools synchronously by running the MCP handshake via
 * spawnSync. This lets us register tools in the extension body
 * before pi's _buildRuntime scans them.
 */
function discoverToolsSync({ binary, args }: { binary: string; args: string[] }): { tools: McpToolDefinition[]; instructions: string | undefined } {
  const initMsg = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-pencil-extension", version: "1.0.0" },
    },
  });

  const notifyMsg = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  const listMsg = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  const input = `${initMsg}\n${notifyMsg}\n${listMsg}\n`;

  const result = spawnSync(binary, args, {
    input,
    timeout: 10_000,
    encoding: "utf-8",
    env: { ...process.env },
  });

  if (result.error || result.status !== null && result.status !== 0) {
    throw new Error(
      `Pencil MCP sync discovery failed: ${result.error?.message ?? result.stderr ?? "unknown error"}`
    );
  }

  const lines = (result.stdout ?? "").split("\n").filter((l: string) => l.trim());
  let instructions: string | undefined;
  let tools: McpToolDefinition[] = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1 && msg.result?.instructions) {
        instructions = msg.result.instructions;
      }
      if (msg.id === 2 && msg.result?.tools) {
        tools = msg.result.tools;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return { tools, instructions };
}

export default function (pi: ExtensionAPI) {
  const config = getConfig();
  let client: McpClient | undefined;
  let clientPromise: Promise<McpClient> | undefined;
  let serverInstructions: string | undefined;

  // Discover tools synchronously so pi picks them up during _buildRuntime
  let discoveredTools: McpToolDefinition[] = [];
  try {
    const discovery = discoverToolsSync({ binary: config.binary, args: config.args });
    discoveredTools = discovery.tools;
    serverInstructions = discovery.instructions;
  } catch {
    // Pencil binary missing or not responding -- no tools registered
  }

  /**
   * Get or create the async MCP client (lazy, shared).
   */
  function getClient(): Promise<McpClient> {
    if (client) return Promise.resolve(client);
    if (clientPromise) return clientPromise;

    clientPromise = createMcpClient({
      command: config.binary,
      args: config.args,
    }).then((c) => {
      client = c;
      clientPromise = undefined;
      return c;
    }).catch((err) => {
      clientPromise = undefined;
      throw err;
    });

    return clientPromise;
  }

  // Register all discovered tools synchronously
  for (const tool of discoveredTools) {
    const schema = convertJsonSchemaToTypebox({ schema: tool.inputSchema });

    pi.registerTool({
      name: `pencil_${tool.name}`,
      label: `Pencil: ${tool.name}`,
      description: tool.description,
      parameters: schema,
      async execute(_toolCallId, params, signal) {
        let mcpClient: McpClient;
        try {
          mcpClient = await getClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Pencil MCP server is not connected: ${message}` }],
            isError: true,
          };
        }

        try {
          const result = await mcpClient.callTool({
            name: tool.name,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP params are dynamic JSON
            args: params as Record<string, any>,
            signal,
          });

          const contentParts = (result.content ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP content parts have varying shapes
            (part: any) => {
              if (part.type === "image" && part.data) {
                return {
                  type: "image" as const,
                  data: part.data as string,
                  mimeType: (part.mimeType ?? part.mime_type ?? "image/png") as string,
                };
              }
              return { type: "text" as const, text: part.text ?? JSON.stringify(part) };
            }
          );

          return {
            content: contentParts.length > 0 ? contentParts : [{ type: "text", text: "(empty response)" }],
            isError: result.isError ?? false,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Pencil MCP error: ${message}` }],
            isError: true,
          };
        }
      },
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (discoveredTools.length > 0) {
      // Eagerly connect the async client so the first tool call is fast
      try {
        await getClient();
        ctx.ui.setStatus("pencil", "Pencil connected");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Pencil MCP failed to connect: ${message}`, "error");
      }
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!serverInstructions) return;

    return {
      systemPrompt: event.systemPrompt + "\n\n## Pencil MCP Instructions\n\n" + serverInstructions,
    };
  });

  pi.on("session_shutdown", async () => {
    if (client) {
      client.close();
      client = undefined;
    }
  });
}

/**
 * Converts a JSON Schema object to a TypeBox TObject.
 * Handles the subset of JSON Schema that MCP tools typically use.
 */
function convertJsonSchemaToTypebox({ schema }: { schema: Record<string, unknown> }): TObject {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];
  const tbProps: TProperties = {};

  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    const converted = convertProperty({ prop });
    tbProps[key] = isRequired ? converted : Type.Optional(converted);
  }

  return Type.Object(tbProps);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive JSON Schema conversion requires dynamic types
function convertProperty({ prop }: { prop: Record<string, unknown> }): any {
  const description = prop.description as string | undefined;
  const opts = description ? { description } : {};

  if (prop.enum) {
    const values = prop.enum as string[];
    return StringEnum(values, opts);
  }

  switch (prop.type) {
    case "string":
      return Type.String(opts);
    case "number":
    case "integer":
      return Type.Number(opts);
    case "boolean":
      return Type.Boolean(opts);
    case "array": {
      const items = (prop.items ?? { type: "string" }) as Record<string, unknown>;
      return Type.Array(convertProperty({ prop: items }), opts);
    }
    case "object": {
      if (prop.properties) {
        return convertJsonSchemaToTypebox({ schema: prop as Record<string, unknown> });
      }
      // Open-ended object with no defined properties
      return Type.Record(Type.String(), Type.Unknown(), opts);
    }
    default:
      return Type.Unknown(opts);
  }
}
