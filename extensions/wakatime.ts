/**
 * wakatime extension
 *
 * Time tracking for pi via the WakaTime HTTPS API (no wakatime-cli binary).
 * Auth is API-key only: `/wakatime login [key]` stores the key in
 * ~/.pi/agent/wakatime.json (0600), with WAKATIME_API_KEY as env fallback.
 * With no key anywhere the extension is a silent no-op on every host.
 *
 * Tracking hooks `tool_call`: edit/write always send a heartbeat,
 * reads send unless the same file was sent <120s ago, everything else
 * (bash, grep, …) is skipped. Project identity is lowercase owner/repo
 * parsed from the git remote, so clones, git worktrees, and paseo
 * worktrees on every machine report one project.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync, statSync } from "node:fs";
import { homedir, hostname, platform, arch, release } from "node:os";
import { join, resolve, extname, basename, dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const API_BASE = "https://api.wakatime.com/api/v1";
const STORE_PATH = join(homedir(), ".pi", "agent", "wakatime.json");
const QUEUE_PATH = join(homedir(), ".pi", "agent", "wakatime-queue.json");
const QUEUE_CAP = 500;
const READ_THROTTLE_MS = 120_000;
const MACHINE = (process.env.WAKATIME_MACHINE_NAME || hostname()).replace(/\s+/g, "-").toLowerCase();
const PLUGIN_UA = "pi-wakatime/4.6.0 (" + platform() + "-" + release() + "-" + arch() + ") host/" + MACHINE;

type Heartbeat = {
	entity: string;
	type: "file";
	category: "ai coding";
	time: number;
	project?: string;
	project_root_count?: number;
	branch?: string;
	language?: string;
	is_write: boolean;
	ai_session?: string;
	ai_line_changes?: number;
	human_line_changes?: number;
};

const LANGUAGE_BY_EXT: Record<string, string> = {
	".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
	".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".go": "Go",
	".rs": "Rust", ".java": "Java", ".rb": "Ruby", ".php": "PHP",
	".swift": "Swift", ".kt": "Kotlin", ".kts": "Kotlin", ".c": "C", ".h": "C",
	".cc": "C++", ".cpp": "C++", ".hpp": "C++", ".cs": "C#", ".sh": "Shell Script",
	".bash": "Shell Script", ".zsh": "Shell Script", ".md": "Markdown", ".mdx": "Markdown",
	".json": "JSON", ".jsonc": "JSON", ".yaml": "YAML", ".yml": "YAML",
	".toml": "TOML", ".css": "CSS", ".scss": "SCSS", ".html": "HTML", ".vue": "Vue",
	".svelte": "Svelte", ".sql": "SQL", ".tf": "Terraform", ".lua": "Lua",
	".r": "R", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang", ".hs": "Haskell",
	".scala": "Scala", ".clj": "Clojure", ".dart": "Dart", ".zig": "Zig",
};

function loadKey(): string | null {
	try {
		const raw = readFileSync(STORE_PATH, "utf8");
		const key = (JSON.parse(raw) as { api_key?: unknown }).api_key;
		if (typeof key === "string" && key) return key;
	} catch {}
	if (process.env.WAKATIME_API_KEY) return process.env.WAKATIME_API_KEY;
	return null;
}

function storeKey(key: string): void {
	writeFileSync(STORE_PATH, JSON.stringify({ api_key: key }) + "\n", { mode: 0o600 });
	try {
		chmodSync(STORE_PATH, 0o600);
	} catch {}
}

function clearKey(): void {
	try {
		unlinkSync(STORE_PATH);
	} catch {}
}

function authHeader(key: string): string {
	return "Basic " + Buffer.from(key + ":").toString("base64");
}

function git(dir: string, ...args: string[]): string {
	try {
		const r = spawnSync("git", ["-C", dir, ...args], {
			encoding: "utf8",
			timeout: 5000,
		});
		return r.status === 0 ? (r.stdout as string).trim() : "";
	} catch {
		return "";
	}
}

/** Lowercase owner/repo from any remote URL form (https, ssh, internal mirror). */
function parseRepo(remote: string): string | null {
	let rest = remote.trim();
	if (!rest) return null;
	if (!rest.includes("://") && rest.includes(":")) {
		rest = rest.slice(rest.indexOf(":") + 1); // scp-like: host:owner/repo
	}
	rest = rest.replace(/\/+$/, "").replace(/\.git$/, "");
	const parts = rest.split("/").filter(Boolean);
	if (parts.length < 2) return null;
	return (parts[parts.length - 2] + "/" + parts[parts.length - 1]).toLowerCase();
}

function projectInfo(absPath: string): Pick<Heartbeat, "project" | "project_root_count" | "branch"> {
	let dir = absPath;
	try {
		if (!statSync(absPath).isDirectory()) {
			dir = dirname(absPath);
		}
	} catch {
		dir = dirname(absPath);
	}
	const top = git(dir, "rev-parse", "--show-toplevel");
	if (!top) {
		const segs = dir.split("/").filter(Boolean);
		return { project: segs[segs.length - 1] ?? "unknown" };
	}
	let project = basename(top);
	const remotes = git(top, "remote").split("\n").map((s) => s.trim()).filter(Boolean);
	for (const name of ["origin", ...remotes]) {
		const parsed = parseRepo(git(top, "remote", "get-url", name));
		if (parsed) {
			project = parsed;
			break;
		}
	}
	const out: Pick<Heartbeat, "project" | "project_root_count" | "branch"> = {
		project,
		project_root_count: top.split("/").filter(Boolean).length,
	};
	const branch = git(top, "branch", "--show-current");
	if (branch) out.branch = branch;
	try {
		const pkg = JSON.parse(readFileSync(join(top, "package.json"), "utf8")) as { name?: unknown };
		if (!remotes.length && typeof pkg.name === "string" && pkg.name) {
			out.project = pkg.name.includes("/") ? pkg.name.split("/")[1].toLowerCase() : pkg.name.toLowerCase();
		}
	} catch {}
	return out;
}

function countLines(v: unknown): number {
	return typeof v === "string" && v ? v.split("\n").length : 0;
}

function aiLineChanges(toolName: string, input: Record<string, unknown>): number {
	try {
		if (toolName === "write") {
			return countLines(input.content ?? input.text ?? input.newText);
		}
		// edit shapes vary; cover the common field names
		const added = countLines(input.newText ?? input.new_string ?? input.newString ?? input.content ?? input.text);
		const removed = countLines(input.oldText ?? input.old_string ?? input.oldString);
		return added + removed;
	} catch {
		return 0;
	}
}

function loadQueue(): Heartbeat[] {
	try {
		const q = JSON.parse(readFileSync(QUEUE_PATH, "utf8")) as unknown;
		return Array.isArray(q) ? (q as Heartbeat[]) : [];
	} catch {
		return [];
	}
}

function saveQueue(q: Heartbeat[]): void {
	try {
		writeFileSync(QUEUE_PATH, JSON.stringify(q.slice(-QUEUE_CAP)));
	} catch {}
}

async function flushQueue(key: string): Promise<void> {
	const q = loadQueue();
	if (q.length === 0) return;
	const headers = {
		Authorization: authHeader(key),
		"Content-Type": "application/json",
		"User-Agent": PLUGIN_UA,
	};
	const remaining = [...q];
	while (remaining.length > 0) {
		const batch = remaining.slice(0, 25);
		let res: Response;
		try {
			res = await fetch(API_BASE + "/users/current/heartbeats.bulk", {
				method: "POST",
				headers,
				body: JSON.stringify(batch),
			});
		} catch {
			break; // still offline — keep the rest queued
		}
		if (!res.ok && res.status !== 202) break;
		remaining.splice(0, batch.length);
	}
	saveQueue(remaining);
}

async function sendHeartbeat(key: string, hb: Heartbeat): Promise<void> {
	try {
		const res = await fetch(API_BASE + "/users/current/heartbeats", {
			method: "POST",
			headers: {
				Authorization: authHeader(key),
				"Content-Type": "application/json",
				"User-Agent": PLUGIN_UA,
			},
			body: JSON.stringify(hb),
		});
		if (res.ok || res.status === 202) {
			await flushQueue(key);
			return;
		}
	} catch {
		// offline — queue below
	}
	const q = loadQueue();
	q.push(hb);
	saveQueue(q);
}

/** Pi's own session id, parsed from the session file name (<ts>_<uuid>.jsonl). */
function piSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
	try {
		const file = ctx.sessionManager.getSessionFile() as unknown;
		if (typeof file !== "string" || !file) return undefined;
		const base = basename(file).replace(/\.jsonl$/, "");
		const id = base.includes("_") ? base.slice(base.lastIndexOf("_") + 1) : base;
		return id || undefined;
	} catch {
		return undefined;
	}
}

export default function wakatime(pi: ExtensionAPI) {
	let aiSession: string | undefined;
	const lastSent = new Map<string, number>();
	// Token usage since the last sent heartbeat; attached as deltas.
	let pendingInput = 0;
	let pendingOutput = 0;
	let pendingPrompt = 0;

	pi.on("message_end", async (event) => {
		try {
			const msg = (event as unknown as { message?: Record<string, unknown> }).message;
			if (!msg) return;
			const usage = msg.usage as { input?: unknown; output?: unknown } | undefined;
			if (usage) {
				if (typeof usage.input === "number") pendingInput += usage.input;
				if (typeof usage.output === "number") pendingOutput += usage.output;
			}
			if (msg.role === "user") {
				const c = msg.content;
			if (typeof c === "string") pendingPrompt += c.length;
			else if (Array.isArray(c)) {
					for (const b of c) {
						const t = (b as { type?: unknown; text?: unknown }).text;
						if (typeof t === "string") pendingPrompt += t.length;
					}
				}
		}
		} catch {}
	});

	pi.on("session_start", (_event, ctx) => {
		aiSession = piSessionId(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		const key = loadKey();
		if (!key) return; // no key anywhere: silent no-op on every host
		const toolName = (event.toolName ?? "") as string;
		if (toolName !== "read" && toolName !== "write" && toolName !== "edit") return;
		const rawPath = (event.input as Record<string, unknown> | undefined)?.path;
		if (typeof rawPath !== "string" || !rawPath) return;

		const absPath = resolve(ctx.cwd ?? process.cwd(), rawPath);
		const isWrite = toolName !== "read";
		const now = Date.now();
		if (!isWrite) {
			const prev = lastSent.get(absPath) ?? 0;
			const lastEntity = [...lastSent.keys()].pop();
			if (lastEntity === absPath && now - prev < READ_THROTTLE_MS) return;
		}
		lastSent.set(absPath, now);

		if (!aiSession) aiSession = piSessionId(ctx);
		const inputTokens = Math.round(pendingInput);
		const outputTokens = Math.round(pendingOutput);
		const promptLength = Math.round(pendingPrompt);
		pendingInput = 0;
		pendingOutput = 0;
		pendingPrompt = 0;
		const hb: Heartbeat = {
			entity: absPath,
			type: "file",
			category: "ai coding",
			time: now / 1000,
			is_write: isWrite,
			...(aiSession ? { ai_session: aiSession } : null),
			ai_line_changes: aiLineChanges(toolName, (event.input ?? {}) as Record<string, unknown>),
			human_line_changes: 0,
			...(inputTokens > 0 ? { ai_input_tokens: inputTokens } : null),
			...(outputTokens > 0 ? { ai_output_tokens: outputTokens } : null),
			...(promptLength > 0 ? { ai_prompt_length: promptLength } : null),
			...projectInfo(absPath),
		};
		const lang = LANGUAGE_BY_EXT[extname(absPath).toLowerCase()];
		if (lang) hb.language = lang;

		void sendHeartbeat(key, hb); // fire-and-forget: never touch the turn
	});

	pi.registerCommand("wakatime", {
		description: "WakaTime time tracking: login [key] | logout | status",
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const sub = (parts[0] ?? "status").toLowerCase();

			if (sub === "login") {
				let key = parts.find((p) => p !== "login" && p !== "--key" && !p.startsWith("-"));
				if (!key && ctx.hasUI) {
					const pasted = await ctx.ui.input("Paste your WakaTime API key (Settings → Account → Secret API Key):", "");
					key = pasted?.trim() || undefined;
				}
				if (!key) {
					ctx.ui.notify("Usage: /wakatime login [key]  —  find your key at wakatime.com → Settings → Account.", "error");
					return;
				}
				let res: Response;
				try {
					res = await fetch(API_BASE + "/users/current", {
						headers: { Authorization: authHeader(key), "User-Agent": PLUGIN_UA },
					});
				} catch {
					ctx.ui.notify("WakaTime unreachable — check your network and retry.", "error");
					return;
				}
				if (!res.ok) {
					ctx.ui.notify("That key didn't work (HTTP " + res.status + "). Check it and retry.", "error");
					return;
				}
				const me = (await res.json()) as { data?: { display_name?: string } };
				storeKey(key);
				ctx.ui.notify(
					"WakaTime tracking as " + (me.data?.display_name ?? "unknown") + ". Agent activity now reports under category \"ai coding\".",
					"info",
				);
				return;
			}

			if (sub === "logout") {
				clearKey();
				ctx.ui.notify("WakaTime key removed from this machine. (To revoke it fully, regenerate it in WakaTime Settings.)", "info");
				return;
			}

			// status (default)
			const key = loadKey();
			if (!key) {
				ctx.ui.notify(
					"WakaTime: not configured on this machine. /wakatime login [key]" +
						(process.env.WAKATIME_API_KEY ? "" : "  (or set WAKATIME_API_KEY)"),
					"warning",
				);
				return;
			}
			try {
				const res = await fetch(API_BASE + "/users/current", {
					headers: { Authorization: authHeader(key), "User-Agent": PLUGIN_UA },
				});
				if (!res.ok) {
					ctx.ui.notify("WakaTime: stored key rejected (HTTP " + res.status + "). /wakatime login again.", "error");
					return;
				}
				const me = (await res.json()) as { data?: { display_name?: string } };
				const queued = loadQueue().length;
				ctx.ui.notify(
					"WakaTime: tracking as " + (me.data?.display_name ?? "unknown") +
						" (" + (process.env.WAKATIME_API_KEY && !existsSync(STORE_PATH) ? "env key" : "stored key") + ")" +
						(queued > 0 ? " — " + queued + " heartbeat(s) queued offline." : ""),
					"info",
				);
			} catch {
				ctx.ui.notify("WakaTime: unreachable (offline?). Tracking keeps queuing locally.", "warning");
			}
		},
	});
}
