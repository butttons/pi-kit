/**
 * Minimal MCP stdio client.
 *
 * Spawns the MCP server as a child process, performs the initialize
 * handshake, discovers tools, and provides a callTool method.
 *
 * Uses JSON-RPC 2.0 over newline-delimited stdio.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type McpToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpClient = {
  tools: McpToolDefinition[];
  serverInstructions: string | undefined;
  callTool: (params: { name: string; args: Record<string, unknown>; signal?: AbortSignal }) => Promise<McpToolResult>;
  close: () => void;
};

export async function createMcpClient({ command, args }: { command: string; args: string[] }): Promise<McpClient> {
  const proc = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const reader = createInterface({ input: proc.stdout! });
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

  reader.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (msg.id !== undefined && pending.has(msg.id)) {
        const handler = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) {
          handler.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          handler.resolve(msg.result);
        }
      }
    } catch {
      // Ignore non-JSON lines (server logging, etc.)
    }
  });

  proc.on("error", (err) => {
    for (const [, handler] of pending) {
      handler.reject(err);
    }
    pending.clear();
  });

  proc.on("exit", () => {
    for (const [, handler] of pending) {
      handler.reject(new Error("MCP server process exited"));
    }
    pending.clear();
  });

  function send({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const id = nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} });

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin!.write(msg + "\n", (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      });
    });
  }

  // Initialize handshake
  const initResult = (await send({
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-pencil-extension", version: "1.0.0" },
    },
  })) as {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    serverInfo: { name: string; version: string };
    instructions?: string;
  };

  const serverInstructions = initResult.instructions;

  // Send initialized notification (required by MCP before calling tools)
  const notifyMsg = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
  proc.stdin!.write(notifyMsg + "\n");

  // Discover tools
  const toolsResult = (await send({ method: "tools/list" })) as {
    tools: McpToolDefinition[];
  };

  return {
    tools: toolsResult.tools,
    serverInstructions,

    async callTool({ name, args, signal }) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      const resultPromise = send({
        method: "tools/call",
        params: { name, arguments: args },
      });

      if (signal) {
        return new Promise<McpToolResult>((resolve, reject) => {
          const onAbort = () => reject(new Error("Aborted"));
          signal.addEventListener("abort", onAbort, { once: true });
          resultPromise
            .then((r) => resolve(r as McpToolResult))
            .catch(reject)
            .finally(() => signal.removeEventListener("abort", onAbort));
        });
      }

      return resultPromise as Promise<McpToolResult>;
    },

    close() {
      reader.close();
      proc.stdin!.end();
      proc.kill("SIGTERM");
    },
  };
}
