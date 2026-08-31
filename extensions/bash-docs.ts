/**
 * bash-docs
 *
 * Keeps docs from drifting by running bash inside ```auto:bash blocks at read time.
 *
 * Affected docs:
 *   - AGENTS.md / CLAUDE.md (expanded in the system prompt every turn)
 *   - SKILL.md files read via the read tool (expanded in the tool result)
 *
 * The file-name allowlist is configurable via `~/.pi/agent/settings.json`:
 *   `{ "bashDocs": { "fileNames": ["AGENTS.md", "CLAUDE.md", "SKILL.md"] } }`
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md", "SKILL.md", "README.md"];
const BLOCK_RE = /```auto:bash\s*\n([\s\S]*?)\n```/g;
const EXEC_TIMEOUT = 10000;

interface Config {
	fileNames: string[];
}

function loadConfig(): Config {
	const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	try {
		const raw = fs.readFileSync(settingsPath, "utf8");
		const settings = JSON.parse(raw);
		if (Array.isArray(settings?.bashDocs?.fileNames)) {
			return { fileNames: settings.bashDocs.fileNames };
		}
	} catch {
		// fall through to defaults
	}
	return { fileNames: DEFAULT_FILE_NAMES };
}

async function expandBlocks(
	source: string,
	exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>,
): Promise<string> {
	const matches = Array.from(source.matchAll(BLOCK_RE));
	if (matches.length === 0) return source;

	let result = source;
	// Replace from the end so earlier match indices stay valid.
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i];
		const command = match[1].trim();
		const replacement = await runBlock(command, exec);
		result = result.slice(0, match.index) + replacement + result.slice(match.index! + match[0].length);
	}
	return result;
}

async function runBlock(
	command: string,
	exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>,
): Promise<string> {
	if (!command) return "[bash-docs] empty command";
	try {
		const { stdout, stderr, code } = await exec(command);
		const output = (stdout || stderr || "").trim();
		if (code !== 0) {
			return `[bash-docs] exit ${code}: ${output}`;
		}
		return output;
	} catch (err: any) {
		return `[bash-docs] ${err?.message || "execution failed"}`;
	}
}

export default function bashDocs(pi: ExtensionAPI) {
	const config = loadConfig();
	const allowedReads = new Set<string>();

	pi.on("session_start", () => {
		allowedReads.clear();
	});

	// Expand blocks in AGENTS.md / CLAUDE.md that are embedded in the system prompt.
	pi.on("before_agent_start", async (event) => {
		if (!BLOCK_RE.test(event.systemPrompt)) return;
		BLOCK_RE.lastIndex = 0;
		const expanded = await expandBlocks(event.systemPrompt, (command) =>
			pi.exec("bash", ["-c", command], { timeout: EXEC_TIMEOUT }),
		);
		return { systemPrompt: expanded };
	});

	// Remember which read calls target docs we care about.
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "read") return;
		const input = event.input as { path: string };
		if (config.fileNames.includes(path.basename(input.path))) {
			allowedReads.add(event.toolCallId);
		}
	});

	// Expand blocks in read tool results for those remembered docs.
	pi.on("message_end", async (event) => {
		if (event.message.role !== "toolResult") return;
		if (!allowedReads.has(event.message.toolCallId)) return;

		const message = event.message as any;
		let changed = false;
		const newContent = [];

		for (const part of message.content ?? []) {
			if (part?.type !== "text") {
				newContent.push(part);
				continue;
			}
			const expanded = await expandBlocks(part.text, (command) =>
				pi.exec("bash", ["-c", command], { timeout: EXEC_TIMEOUT }),
			);
			if (expanded !== part.text) changed = true;
			newContent.push({ ...part, text: expanded });
		}

		if (!changed) return;
		return { message: { ...message, content: newContent } };
	});
}
