/**
 * Fleet Extension
 *
 * First-class subagent orchestration over herdr + past-session recall.
 *
 * Subagent tools (fleet_*) wrap the herdr CLI: named pi rpc-mode agents
 * run in herdr panes grouped into labeled workspaces, with per-slice model
 * tiers, JSON-frame prompting, status polling, and session-JSONL result
 * harvesting. Replaces prompt-level knowledge from the herdr-pi-subagents
 * skill with tools the LLM can call directly.
 *
 * Recall tools (find_threads / read_thread) search and read past pi
 * conversation sessions using ripgrep.
 *
 * Requirements:
 *   - herdr CLI available and HERDR_ENV=1 (fleet tools no-op with an error otherwise)
 *   - herdr pi integration installed: herdr integration install pi
 *
 * Model tiers (always explicit; spawned agents otherwise inherit the user's
 * interactive default):
 *   flash   opencode-go/deepseek-v4-flash   default for all work
 *   complex kimi-coding/kimi-for-coding     multi-file logic, subtle contracts
 *   ultra   kimi-coding/k3-256k             load-bearing design, hard debugging
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ============================================================================
// Types
// ============================================================================

type ExecResult = { stdout: string; stderr: string; code: number };
type Exec = (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<ExecResult>;

type HerdrPane = {
	pane_id: string;
	workspace_id: string;
	tab_id: string;
	cwd: string;
	foreground_cwd?: string;
	agent?: string;
	agent_status?: string;
	agent_session?: { value?: string };
	focused?: boolean;
};

type HerdrAgent = HerdrPane & { name?: string };

type FleetAgentRecord = {
	name: string;
	paneId: string;
	workspaceId: string;
	workspaceLabel: string;
	model: string;
	cwd: string;
	startedAt: number;
};

type SessionMessage = {
	role: string;
	text: string;
	toolCalls: Array<{ name: string; arguments: unknown }>;
};

// ============================================================================
// Constants
// ============================================================================

const MODEL_TIERS = {
	flash: "opencode-go/deepseek-v4-flash",
	complex: "kimi-coding/kimi-for-coding",
	ultra: "kimi-coding/k3-256k",
} as const;

type ModelTier = keyof typeof MODEL_TIERS;

const HERDR_TIMEOUT_MS = 15_000;
const AGENT_WAIT_MAX_MS = 10 * 60 * 1000;

// ============================================================================
// Herdr helpers
// ============================================================================

async function herdrJson<T>({ exec, args }: { exec: Exec; args: string[] }): Promise<T> {
	const { stdout, stderr, code } = await exec("herdr", args, { timeout: HERDR_TIMEOUT_MS });
	const line = stdout.trim().split("\n")[0] ?? "";
	if (code !== 0) {
		throw new Error(`herdr ${args.join(" ")} failed (code ${code}): ${stderr || stdout}`);
	}
	if (!line) {
		// some herdr commands (e.g. pane send-keys) succeed silently
		return undefined as T;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new Error(`herdr ${args.join(" ")} returned non-JSON: ${line.slice(0, 200)}`);
	}
	const envelope = parsed as { error?: { message?: string }; result?: unknown };
	if (envelope.error) {
		throw new Error(`herdr ${args.join(" ")}: ${envelope.error.message ?? "unknown error"}`);
	}
	return envelope.result as T;
}

async function listPanes({ exec }: { exec: Exec }): Promise<HerdrPane[]> {
	const result = await herdrJson<{ panes: HerdrPane[] }>({ exec, args: ["pane", "list"] });
	return result.panes;
}

async function getAgent({ exec, name }: { exec: Exec; name: string }): Promise<HerdrAgent> {
	const result = await herdrJson<{ agent: HerdrAgent }>({ exec, args: ["agent", "get", name] });
	return result.agent;
}

async function sendPromptFrame({
	exec,
	name,
	paneId,
	message,
}: {
	exec: Exec;
	name: string;
	paneId: string;
	message: string;
}): Promise<void> {
	const frame = JSON.stringify({ type: "prompt", message });
	await herdrJson({ exec, args: ["agent", "send", name, frame] });
	await herdrJson({ exec, args: ["pane", "send-keys", paneId, "enter"] });
}

// ============================================================================
// Session JSONL helpers (live subagent visibility + result harvesting)
// ============================================================================

function parseSessionMessages({ sessionFile }: { sessionFile: string }): SessionMessage[] {
	if (!fs.existsSync(sessionFile)) return [];
	const lines = fs.readFileSync(sessionFile, "utf-8").split("\n");
	const messages: SessionMessage[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		let entry: { type?: string; message?: { role?: string; content?: unknown } };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type !== "message" || !entry.message?.role) continue;
		const content = entry.message.content;
		const textParts: string[] = [];
		const toolCalls: Array<{ name: string; arguments: unknown }> = [];
		if (typeof content === "string") {
			textParts.push(content);
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (block?.type === "text" && typeof block.text === "string") textParts.push(block.text);
				if (block?.type === "toolCall" && typeof block.name === "string") {
					toolCalls.push({ name: block.name, arguments: block.arguments });
				}
			}
		}
		messages.push({ role: entry.message.role, text: textParts.join("\n"), toolCalls });
	}
	return messages;
}

function lastAssistantText({ sessionFile }: { sessionFile: string }): string | null {
	const messages = parseSessionMessages({ sessionFile });
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]!;
		if (msg.role === "assistant" && msg.text.trim().length > 0) return msg.text;
	}
	return null;
}

function activityTail({ sessionFile, lines }: { sessionFile: string; lines: number }): string[] {
	const messages = parseSessionMessages({ sessionFile });
	const out: string[] = [];
	for (const msg of messages.slice(-lines)) {
		if (msg.role === "assistant") {
			for (const call of msg.toolCalls) {
				const argsPreview = JSON.stringify(call.arguments)?.slice(0, 120) ?? "";
				out.push(`TOOL ${call.name}: ${argsPreview}`);
			}
			if (msg.text.trim()) out.push(`TEXT: ${msg.text.slice(0, 200)}`);
		} else if (msg.role === "toolResult") {
			out.push(`RESULT: ${msg.text.slice(0, 160)}`);
		}
	}
	return out;
}

// ============================================================================
// Thread search helpers (past sessions)
// ============================================================================

type ThreadSummary = {
	id: string;
	cwd: string;
	timestamp: string;
	preview: string;
	messageCount: number;
	filePath: string;
	matchCount?: number;
};

type SessionFileHeader = { id: string; cwd: string; timestamp: string };

function getSessionsDir(): string {
	return path.join(os.homedir(), ".pi", "agent", "sessions");
}

function getAllSessionFiles({ sessionsDir }: { sessionsDir: string }): string[] {
	const files: string[] = [];
	if (!fs.existsSync(sessionsDir)) return files;
	for (const dirEntry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
		if (!dirEntry.isDirectory() || dirEntry.name.startsWith(".")) continue;
		const dirPath = path.join(sessionsDir, dirEntry.name);
		for (const fileEntry of fs.readdirSync(dirPath, { withFileTypes: true })) {
			if (fileEntry.name.endsWith(".jsonl")) files.push(path.join(dirPath, fileEntry.name));
		}
	}
	return files;
}

function readSessionHeader({ filePath }: { filePath: string }): SessionFileHeader | null {
	if (!fs.existsSync(filePath)) return null;
	const fd = fs.openSync(filePath, "r");
	try {
		const buf = Buffer.alloc(4096);
		const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
		const firstLine = buf.toString("utf-8", 0, bytesRead).split("\n")[0] ?? "";
		const parsed = JSON.parse(firstLine) as {
			type?: string;
			id?: string;
			cwd?: string;
			timestamp?: string;
		};
		if (parsed.type !== "session" || !parsed.id) return null;
		return { id: parsed.id, cwd: parsed.cwd ?? "", timestamp: parsed.timestamp ?? "" };
	} catch {
		return null;
	} finally {
		fs.closeSync(fd);
	}
}

async function searchMatchCounts({
	exec,
	query,
	sessionsDir,
}: {
	exec: Exec;
	query: string;
	sessionsDir: string;
}): Promise<Map<string, number>> {
	const results = new Map<string, number>();
	const collect = (stdout: string) => {
		for (const line of stdout.split("\n")) {
			if (!line.trim()) continue;
			const match = line.match(/^(.+):(\d+)$/);
			if (match) results.set(match[1]!, parseInt(match[2]!, 10));
		}
	};
	try {
		const { stdout, code } = await exec("rg", ["-c", "-i", "--", query, sessionsDir], { timeout: 10_000 });
		if (code === 0 || code === 1) {
			collect(stdout);
			return results;
		}
	} catch {
		// ripgrep unavailable, fall back to grep
	}
	try {
		const { stdout } = await exec("grep", ["-r", "-c", "-i", query, sessionsDir], { timeout: 30_000 });
		collect(stdout);
	} catch {
		// no matches or grep unavailable
	}
	return results;
}

function firstUserMessagePreview({ filePath }: { filePath: string }): { preview: string; messageCount: number } {
	const messages = parseSessionMessages({ sessionFile: filePath });
	const firstUser = messages.find((m) => m.role === "user" && m.text.trim().length > 0);
	return {
		preview: firstUser ? firstUser.text.slice(0, 200) : "(no user message)",
		messageCount: messages.length,
	};
}

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	// In-memory registry of agents dispatched from this session.
	const agents = new Map<string, FleetAgentRecord>();
	// workspace label -> workspace id, verified before reuse.
	const workspaces = new Map<string, string>();

	const exec: Exec = (cmd, args, opts) => pi.exec(cmd, args, opts);

	function isHerdrAvailable(): boolean {
		return process.env.HERDR_ENV === "1";
	}

	function requireHerdr(): void {
		if (!isHerdrAvailable()) {
			throw new Error("fleet tools require herdr (HERDR_ENV=1 not set). Run pi inside herdr to use subagents.");
		}
	}

	async function ensureWorkspace({
		label,
		cwd,
	}: {
		label: string;
		cwd: string;
	}): Promise<{ workspaceId: string; isNew: boolean }> {
		const existing = workspaces.get(label);
		if (existing) {
			try {
				await herdrJson({ exec, args: ["workspace", "get", existing] });
				return { workspaceId: existing, isNew: false };
			} catch {
				workspaces.delete(label);
			}
		}
		const result = await herdrJson<{ workspace: { workspace_id: string } }>({
			exec,
			args: ["workspace", "create", "--cwd", cwd, "--label", label, "--no-focus"],
		});
		workspaces.set(label, result.workspace.workspace_id);
		return { workspaceId: result.workspace.workspace_id, isNew: true };
	}

	// ========================================================================
	// fleet_survey
	// ========================================================================
	pi.registerTool({
		name: "fleet_survey",
		label: "Fleet Survey",
		description:
			"Survey live herdr panes before dispatching subagents. Returns every pane with cwd, agent status, foreground process, and a short output tail so you can identify running dev servers and services. Subagents start blank and cannot discover these themselves; put the findings (exact pane ids, ports, ready-to-run herdr commands) into dispatch prompts.",
		promptSnippet: "Survey live herdr panes (dev servers, services) before dispatching subagents",
		promptGuidelines: [
			"Always call fleet_survey before a batch of fleet_dispatch calls so dispatch prompts can reference live services by exact pane id.",
			"Never let subagents run herdr pane list themselves; give them exact pane ids and ready-to-run herdr pane read commands in the prompt.",
		],
		parameters: Type.Object({
			lines: Type.Optional(Type.Number({ description: "Output tail lines per pane (default 8)" })),
		}),

		async execute(_toolCallId, params) {
			requireHerdr();
			const lines = params.lines ?? 8;
			const panes = await listPanes({ exec });
			const rows: Array<Record<string, unknown>> = [];

			for (const pane of panes) {
				let foreground = "";
				try {
					const info = await herdrJson<{ command?: string; name?: string }>({
						exec,
						args: ["pane", "process-info", pane.pane_id],
					});
					foreground = info.command ?? info.name ?? "";
				} catch {
					// best effort
				}
				let tail = "";
				try {
					const { stdout } = await exec(
						"herdr",
						["pane", "read", pane.pane_id, "--source", "recent-unwrapped", "--lines", String(lines)],
						{ timeout: HERDR_TIMEOUT_MS },
					);
					const tailLines = stdout
						.split("\n")
						.map((l) => l.trimEnd())
						.filter((l) => l.trim().length > 0)
						.slice(-4);
					tail = tailLines.join(" | ").slice(0, 300);
				} catch {
					// best effort
				}
				rows.push({
					paneId: pane.pane_id,
					workspaceId: pane.workspace_id,
					cwd: pane.cwd,
					agent: pane.agent ?? null,
					agentStatus: pane.agent_status ?? "unknown",
					isFocused: pane.focused ?? false,
					foreground,
					tail,
				});
			}

			return {
				content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
				details: { panes: rows },
			};
		},
	});

	// ========================================================================
	// fleet_dispatch
	// ========================================================================
	pi.registerTool({
		name: "fleet_dispatch",
		label: "Fleet Dispatch",
		description:
			"Spawn a named pi rpc-mode subagent in a herdr pane inside a labeled workspace, with an explicit model tier, and send it a self-contained prompt. Workspaces group related agents: reuse the same workspaceLabel for one logical work group; use different labels for unrelated slices. The prompt must be fully self-contained (paths, context, expected output shape, live-environment facts from fleet_survey). Instruct the subagent to never run git commit or destructive shell commands (extension UI dialogs hang rpc agents).",
		promptSnippet: "Dispatch a named pi subagent (herdr pane, rpc mode, explicit model tier)",
		promptGuidelines: [
			"Only call fleet_dispatch when the user has explicitly asked for a subagent; the user dictates the slice and the model tier, never decide to spawn on your own.",
			"Every fleet_dispatch prompt must tell the subagent its own agent name and pane id, and forbid git commit / destructive commands (only the orchestrator commits).",
			"Close agents with fleet_stop as soon as their result is harvested; do not leave finished agents lying around.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Unique agent name (used for all later fleet_* calls)" }),
			prompt: Type.String({ description: "Self-contained task prompt" }),
			tier: Type.Optional(
				StringEnum(["flash", "complex", "ultra"] as const, {
					description: "Model tier picked by the user: flash (default), complex, ultra",
				}),
			),
			model: Type.Optional(
				Type.String({ description: "Explicit model id override (provider/model). Takes precedence over tier." }),
			),
			workspaceLabel: Type.Optional(
				Type.String({ description: "Workspace label grouping this agent with related agents (default: fleet)" }),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory (default: current session cwd)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			requireHerdr();
			if (agents.has(params.name)) {
				throw new Error(`Agent "${params.name}" already exists. Use fleet_send for follow-ups or pick another name.`);
			}
			const tier = (params.tier ?? "flash") as ModelTier;
			const model = params.model ?? MODEL_TIERS[tier];
			const cwd = params.cwd ?? ctx.cwd;
			const label = params.workspaceLabel ?? "fleet";

			const { workspaceId } = await ensureWorkspace({ label, cwd });

			const started = await herdrJson<{ agent: HerdrAgent }>({
				exec,
				args: [
					"agent",
					"start",
					params.name,
					"--workspace",
					workspaceId,
					"--no-focus",
					"--cwd",
					cwd,
					"--",
					"pi",
					"--mode",
					"rpc",
					"--model",
					model,
					"--approve",
				],
			});
			const paneId = started.agent.pane_id;

			agents.set(params.name, {
				name: params.name,
				paneId,
				workspaceId,
				workspaceLabel: label,
				model,
				cwd,
				startedAt: Date.now(),
			});

				const reportSuffix = [
				"",
				"---",
				"Orchestrator rules (non-negotiable):",
				"- NEVER run git commit, git push, or any destructive shell command. The orchestrator handles all commits.",
				"- When finished, your final message must be a report: what you did, which files you changed (full paths), and how you verified the work.",
			].join("\n");
			await sendPromptFrame({ exec, name: params.name, paneId, message: params.prompt + reportSuffix });

			return {
				content: [
					{
						type: "text",
						text: `Dispatched "${params.name}" (tier ${tier}, ${model}) in pane ${paneId}, workspace ${workspaceId} (" ${label}"). Prompt delivered. Poll with fleet_status, harvest with fleet_result.`,
					},
				],
				details: { name: params.name, paneId, workspaceId, model, tier },
			};
		},
	});

	// ========================================================================
	// fleet_send
	// ========================================================================
	pi.registerTool({
		name: "fleet_send",
		label: "Fleet Send",
		description:
			"Send a follow-up prompt to a running fleet subagent. Session continuity works. Only send when the agent status is done or idle; a prompt sent mid-turn is rejected by rpc mode.",
		promptSnippet: "Send a follow-up prompt to a fleet subagent",
		parameters: Type.Object({
			name: Type.String({ description: "Agent name" }),
			prompt: Type.String({ description: "Follow-up prompt" }),
		}),

		async execute(_toolCallId, params) {
			requireHerdr();
			const agent = await getAgent({ exec, name: params.name });
			const status = agent.agent_status ?? "unknown";
			if (status === "working") {
				throw new Error(`Agent "${params.name}" is still working. Wait for done/idle (fleet_status) before sending.`);
			}
			await sendPromptFrame({ exec, name: params.name, paneId: agent.pane_id, message: params.prompt });
			return {
				content: [{ type: "text", text: `Follow-up delivered to "${params.name}" (pane ${agent.pane_id}).` }],
				details: { name: params.name, paneId: agent.pane_id },
			};
		},
	});

	// ========================================================================
	// fleet_status
	// ========================================================================
	pi.registerTool({
		name: "fleet_status",
		label: "Fleet Status",
		description:
			"Check fleet subagent status. Without a name, lists all herdr agents with their status (idle/working/done). With a name, also includes a live activity tail parsed from the agent's session JSONL (recent tool calls, text, results) so you can see what it is doing mid-turn.",
		promptSnippet: "Check subagent status and live mid-turn activity",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Agent name for detailed status + activity tail" })),
			tailLines: Type.Optional(Type.Number({ description: "Activity tail message count (default 15)" })),
		}),

		async execute(_toolCallId, params) {
			requireHerdr();
			if (!params.name) {
				const result = await herdrJson<{ agents: HerdrAgent[] }>({ exec, args: ["agent", "list"] });
				const rows = result.agents.map((a) => ({
					paneId: a.pane_id,
					workspaceId: a.workspace_id,
					cwd: a.cwd,
					agentStatus: a.agent_status ?? "unknown",
					sessionFile: a.agent_session?.value ?? null,
				}));
				return {
					content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
					details: { agents: rows },
				};
			}

			const agent = await getAgent({ exec, name: params.name });
			const sessionFile = agent.agent_session?.value;
			const tail = sessionFile ? activityTail({ sessionFile, lines: params.tailLines ?? 15 }) : [];
			const record = agents.get(params.name);
			const summary = {
				name: params.name,
				paneId: agent.pane_id,
				workspaceId: agent.workspace_id,
				agentStatus: agent.agent_status ?? "unknown",
				model: record?.model ?? null,
				sessionFile: sessionFile ?? null,
				hasSessionFile: sessionFile ? fs.existsSync(sessionFile) : false,
				activity: tail,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
				details: summary,
			};
		},
	});

	// ========================================================================
	// fleet_result
	// ========================================================================
	pi.registerTool({
		name: "fleet_result",
		label: "Fleet Result",
		description:
			"Harvest a fleet subagent's final answer: the last assistant text message parsed from its session JSONL. Optionally block until the agent reaches done status first. Prefer polling fleet_status between other work over long blocking waits.",
		promptSnippet: "Harvest a subagent's final answer from its session file",
		parameters: Type.Object({
			name: Type.String({ description: "Agent name" }),
			wait: Type.Optional(Type.Boolean({ description: "Block until status done (default false)" })),
			timeoutMs: Type.Optional(Type.Number({ description: `Wait timeout in ms (default 120000, max ${AGENT_WAIT_MAX_MS})` })),
		}),

		async execute(_toolCallId, params) {
			requireHerdr();
			if (params.wait) {
				const timeoutMs = Math.min(params.timeoutMs ?? 120_000, AGENT_WAIT_MAX_MS);
				const { code, stdout } = await exec(
					"herdr",
					["agent", "wait", params.name, "--status", "done", "--timeout", String(timeoutMs)],
					{ timeout: timeoutMs + 10_000 },
				);
				if (code !== 0) {
					throw new Error(`Wait for "${params.name}" failed: ${stdout}`);
				}
			}
			const agent = await getAgent({ exec, name: params.name });
			const sessionFile = agent.agent_session?.value;
			if (!sessionFile || !fs.existsSync(sessionFile)) {
				throw new Error(`No session file yet for "${params.name}" (created lazily after the first turn).`);
			}
			const text = lastAssistantText({ sessionFile });
			if (!text) {
				throw new Error(`No assistant text found yet in session for "${params.name}".`);
			}
			return {
				content: [{ type: "text", text }],
				details: { name: params.name, agentStatus: agent.agent_status ?? "unknown", sessionFile },
			};
		},
	});

	// ========================================================================
	// fleet_stop
	// ========================================================================
	pi.registerTool({
		name: "fleet_stop",
		label: "Fleet Stop",
		description:
			"Stop a fleet subagent: optionally interrupt a running turn (ctrl+c), close its pane, and optionally close the whole workspace when the group is done. Harvest the result with fleet_result first.",
		promptSnippet: "Stop a subagent and clean up its pane/workspace",
		parameters: Type.Object({
			name: Type.String({ description: "Agent name" }),
			interrupt: Type.Optional(Type.Boolean({ description: "Send ctrl+c before closing (default false)" })),
			closeWorkspace: Type.Optional(
				Type.Boolean({ description: "Also close the agent's workspace (default false)" }),
			),
		}),

		async execute(_toolCallId, params) {
			requireHerdr();
			const agent = await getAgent({ exec, name: params.name });
			if (params.interrupt) {
				await herdrJson({ exec, args: ["pane", "send-keys", agent.pane_id, "ctrl+c"] });
			}
			await herdrJson({ exec, args: ["pane", "close", agent.pane_id] });
			let isWorkspaceClosed = false;
			if (params.closeWorkspace) {
				await herdrJson({ exec, args: ["workspace", "close", agent.workspace_id] });
				isWorkspaceClosed = true;
				const record = agents.get(params.name);
				if (record) workspaces.delete(record.workspaceLabel);
			}
			agents.delete(params.name);
			return {
				content: [
					{
						type: "text",
						text: `Stopped "${params.name}" (pane ${agent.pane_id} closed${isWorkspaceClosed ? `, workspace ${agent.workspace_id} closed` : ""}).`,
					},
				],
				details: { name: params.name, isWorkspaceClosed },
			};
		},
	});

	// ========================================================================
	// find_threads
	// ========================================================================
	pi.registerTool({
		name: "find_threads",
		label: "Find Threads",
		description:
			"Search past pi conversation sessions. Use to find previous discussions, code changes, or decisions. Searches message content using ripgrep for speed; filter by working directory; sort by recent, oldest, or relevance.",
		promptSnippet: "Search past conversation sessions by content and directory",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Text to search for in messages (ripgrep)" })),
			cwd: Type.Optional(Type.String({ description: "Filter by working directory (partial match)" })),
			limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
			sort: Type.Optional(
				StringEnum(["recent", "oldest", "relevance"] as const, {
					description: "Sort order: recent (default), oldest, relevance",
				}),
			),
		}),

		async execute(_toolCallId, params) {
			const startTime = Date.now();
			const sessionsDir = getSessionsDir();
			const limit = params.limit ?? 10;
			const sort = params.sort ?? "recent";

			let sessionFiles = getAllSessionFiles({ sessionsDir });
			let matchCounts: Map<string, number> | null = null;

			if (params.query) {
				matchCounts = await searchMatchCounts({ exec, query: params.query, sessionsDir });
				sessionFiles = sessionFiles.filter((f) => matchCounts!.has(f));
			}

			const threads: ThreadSummary[] = [];
			for (const filePath of sessionFiles) {
				const header = readSessionHeader({ filePath });
				if (!header) continue;
				if (params.cwd && !header.cwd.toLowerCase().includes(params.cwd.toLowerCase())) continue;
				const { preview, messageCount } = firstUserMessagePreview({ filePath });
				threads.push({
					id: header.id,
					cwd: header.cwd,
					timestamp: header.timestamp,
					preview,
					messageCount,
					filePath,
					matchCount: matchCounts?.get(filePath),
				});
			}

			if (sort === "recent") {
				threads.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
			} else if (sort === "oldest") {
				threads.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
			} else if (matchCounts) {
				threads.sort((a, b) => (b.matchCount ?? 0) - (a.matchCount ?? 0));
			}

			const limited = threads.slice(0, limit);
			const searchTime = Date.now() - startTime;

			let text = `Found ${threads.length} threads`;
			if (params.query) text += ` matching "${params.query}"`;
			if (params.cwd) text += ` in ${params.cwd}`;
			text += ` (${searchTime}ms)\n\n`;
			for (const t of limited) {
				const date = new Date(t.timestamp).toLocaleDateString();
				text += `[${t.id}] (${date}) ${t.messageCount} msgs`;
				if (t.matchCount) text += `, ${t.matchCount} matches`;
				text += `\n  cwd: ${t.cwd}\n  ${t.preview}\n\n`;
			}
			if (threads.length > limit) {
				text += `... and ${threads.length - limit} more. Raise limit to see more.`;
			}

			return {
				content: [{ type: "text", text }],
				details: { threads: limited, searchTime, total: threads.length },
			};
		},
	});

	// ========================================================================
	// read_thread
	// ========================================================================
	pi.registerTool({
		name: "read_thread",
		label: "Read Thread",
		description:
			"Read a specific past conversation thread by session id or file path. Returns the conversation with user messages, assistant responses, tool call names, and optionally tool results.",
		promptSnippet: "Read a past conversation thread by id or path",
		parameters: Type.Object({
			threadId: Type.String({ description: "Session id or .jsonl file path" }),
			includeToolResults: Type.Optional(
				Type.Boolean({ description: "Include tool result contents (default false)" }),
			),
			maxMessages: Type.Optional(Type.Number({ description: "Max messages to return (default all)" })),
		}),

		async execute(_toolCallId, params) {
			const sessionsDir = getSessionsDir();
			let filePath: string | null = null;

			if (params.threadId.endsWith(".jsonl") || params.threadId.startsWith("/")) {
				filePath = params.threadId;
			} else {
				for (const candidate of getAllSessionFiles({ sessionsDir })) {
					const header = readSessionHeader({ filePath: candidate });
					if (header?.id === params.threadId) {
						filePath = candidate;
						break;
					}
				}
			}

			if (!filePath || !fs.existsSync(filePath)) {
				throw new Error(`Thread not found: ${params.threadId}`);
			}

			const messages = parseSessionMessages({ sessionFile: filePath });
			const limited = params.maxMessages ? messages.slice(0, params.maxMessages) : messages;

			let text = `Thread ${params.threadId} (${messages.length} messages)`;
			const header = readSessionHeader({ filePath });
			if (header) text += `\ncwd: ${header.cwd}\nstarted: ${header.timestamp}`;
			text += "\n\n";

			for (const msg of limited) {
				if (msg.role === "toolResult" && !params.includeToolResults) continue;
				const role = msg.role.toUpperCase();
				if (msg.text.trim()) {
					text += `--- ${role} ---\n${msg.text}\n\n`;
				}
				for (const call of msg.toolCalls) {
					const argsPreview = JSON.stringify(call.arguments)?.slice(0, 300) ?? "";
					text += `--- ${role} TOOL CALL: ${call.name} ---\n${argsPreview}\n\n`;
				}
			}

			if (params.maxMessages && messages.length > params.maxMessages) {
				text += `... truncated, ${messages.length - params.maxMessages} more messages.`;
			}

			return {
				content: [{ type: "text", text }],
				details: { filePath, messageCount: messages.length, returned: limited.length },
			};
		},
	});
}
