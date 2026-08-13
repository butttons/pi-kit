import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FABRIC_PROVIDER_DISCOVER_EVENT,
  FABRIC_PROVIDER_REGISTER_EVENT,
  type FabricActionDescriptor,
  type FabricProvider,
  type FabricProviderDiscovery,
} from "pi-fabric/protocol";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type DaemonConnection = {
  apiBaseUrl: string;
  token: string;
};

type ServerControlFile = {
  connection?: {
    apiBaseUrl?: string;
    auth?: { kind?: string; token?: string };
  };
};

type ExecutorToolEntry = {
  address: string;
  integration: string;
  connection: string;
  name: string;
  description: string;
  requiresApproval: boolean | null;
};

type ExecutorExecutionResult =
  | { status: "completed"; text: string; structured: unknown; isError: boolean }
  | { status: "paused"; text: string; structured: unknown };

const SERVER_CONTROL_PATH = join(
  homedir(),
  ".executor",
  "server-control",
  "server.json",
);

const readDaemonConnection = async (): Promise<DaemonConnection> => {
  const raw = await readFile(SERVER_CONTROL_PATH, "utf8");
  const parsed = JSON.parse(raw) as ServerControlFile;
  const apiBaseUrl = parsed.connection?.apiBaseUrl;
  const token = parsed.connection?.auth?.token;
  if (!apiBaseUrl || !token) {
    throw new Error(
      "Executor daemon connection not found in ~/.executor/server-control/server.json. Start it with: executor daemon run --port 4789 --scope ~/.executor",
    );
  }
  return { apiBaseUrl, token };
};

const executorFetch = async ({
  path,
  method,
  body,
}: {
  path: string;
  method?: string;
  body?: unknown;
}): Promise<unknown> => {
  const { apiBaseUrl, token } = await readDaemonConnection();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Executor API ${path} failed: ${response.status} ${text}`);
  }
  return response.json();
};

const ACTIONS: FabricActionDescriptor[] = [
  {
    name: "search",
    description:
      "Search Executor integration tools by natural-language query. Returns ranked tool addresses (tools.<integration>.org.<connection>.<tool>) with descriptions. Narrow with the integration namespace.",
    risk: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        integration: {
          type: "string",
          description: "Optional integration slug to narrow results (e.g. linear_mcp, github_rest)",
        },
        limit: { type: "number", description: "Max results (default 15)" },
      },
      required: ["query"],
    },
  },
  {
    name: "describe",
    description:
      "Describe one Executor tool: input/output TypeScript shapes and JSON schemas. Use the full address from search.",
    risk: "read",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Full tool address, e.g. tools.linear_mcp.org.zapifyLinear.get_issue",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "call",
    description:
      "Call an Executor integration tool. Returns { ok: true, data } or { ok: false, error }. If the tool requires approval and autoApprove is not set, returns a paused execution with an executionId to resume.",
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Full tool address from search" },
        args: { type: "object", description: "Tool input arguments" },
        autoApprove: {
          type: "boolean",
          description: "Approve write operations inline (default false)",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "resume",
    description: "Resume a paused Executor execution after approval.",
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        executionId: { type: "string" },
        approve: { type: "boolean", description: "Approve (true) or reject (false)" },
      },
      required: ["executionId", "approve"],
    },
  },
  {
    name: "connections",
    description: "List configured Executor connections with health status.",
    risk: "read",
    inputSchema: { type: "object", properties: {} },
  },
];

const normalizeAddress = ({ address }: { address: string }): string =>
  address.startsWith("tools.") ? address.slice("tools.".length) : address;

const provider: FabricProvider = {
  name: "executor",
  description:
    "Executor daemon integrations (Linear, GitHub, Cloudflare, Axiom, PostHog) over the local HTTP API. One sandbox: call tools.executor.call from fabric_exec instead of writing nested executor sandbox code.",

  async list(request) {
    const query = request.query?.toLowerCase();
    if (!query) return ACTIONS;
    return ACTIONS.filter(
      (action) =>
        action.name.includes(query) ||
        action.description.toLowerCase().includes(query),
    );
  },

  async describe(actionName) {
    return ACTIONS.find((action) => action.name === actionName);
  },

  async invoke(actionName, args) {
    switch (actionName) {
      case "search": {
        const params = new URLSearchParams();
        params.set("query", String(args.query ?? ""));
        const all = (await executorFetch({
          path: `/tools?${params.toString()}`,
        })) as ExecutorToolEntry[];
        const tools =
          typeof args.integration === "string"
            ? all.filter((tool) => tool.integration === args.integration)
            : all;
        const limit = typeof args.limit === "number" ? args.limit : 15;
        return tools.slice(0, limit).map((tool) => ({
          address: tool.address,
          name: tool.name,
          description: tool.description,
          requiresApproval: tool.requiresApproval ?? false,
        }));
      }
      case "describe": {
        const address = String(args.address ?? "");
        return executorFetch({
          path: `/tools/schema?address=${encodeURIComponent(address)}`,
        });
      }
      case "call": {
        const address = normalizeAddress({ address: String(args.address ?? "") });
        const callArgs = args.args ?? {};
        const code = `return await tools.${address}(${JSON.stringify(callArgs)})`;
        const result = (await executorFetch({
          path: "/executions",
          method: "POST",
          body: { code, autoApprove: args.autoApprove === true },
        })) as ExecutorExecutionResult;
        if (result.status === "paused") return result;
        try {
          return JSON.parse(result.text);
        } catch {
          return result.structured ?? result.text;
        }
      }
      case "resume": {
        const executionId = String(args.executionId ?? "");
        return executorFetch({
          path: `/executions/${encodeURIComponent(executionId)}/resume`,
          method: "POST",
          body: { approve: args.approve === true },
        });
      }
      case "connections": {
        return executorFetch({ path: "/connections" });
      }
      default:
        throw new Error(`Unknown executor action: ${actionName}`);
    }
  },
};

export default function executorProviderExtension(pi: ExtensionAPI) {
  const register = () => {
    pi.events.emit(FABRIC_PROVIDER_REGISTER_EVENT, {
      version: 1,
      provider,
      overwrite: true,
    });
  };

  register();
  pi.events.on(FABRIC_PROVIDER_DISCOVER_EVENT, (data: unknown) => {
    const event = data as FabricProviderDiscovery;
    event.register(provider, { overwrite: true });
  });
}
