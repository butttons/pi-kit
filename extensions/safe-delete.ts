/**
 * Safe Delete Extension
 *
 * Intercepts bash commands that could cause catastrophic data loss.
 * Goes beyond simple `rm` detection to catch the full spectrum of
 * destructive shell patterns.
 *
 * What it catches:
 *   - rm/rmdir on protected paths or large targets
 *   - find ... -delete / find ... -exec rm
 *   - Recursive chmod/chown on protected paths
 *   - git clean -fdx (untracked file wipe)
 *   - Piped deletions (xargs rm, xargs del)
 *   - File truncation (> file, truncate)
 *   - mv to /dev/null
 *   - dd writing to disk devices
 *   - mkfs/format on devices
 *   - sudo with any of the above
 *   - Wildcard explosions (rm -rf /*, rm -rf ~/*)
 */

import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// --- Configuration ---

const SIZE_THRESHOLD = 100 * 1024 * 1024; // 100MB

// Paths that should always require confirmation regardless of size.
// Resolved at startup so ~ and env vars are expanded.
const PROTECTED_PATHS: string[] = [
	"/",
	"/bin",
	"/sbin",
	"/usr",
	"/etc",
	"/var",
	"/lib",
	"/System",
	"/Applications",
	"/Library",
	"/opt",
	"/private",
	os.homedir(),
	path.join(os.homedir(), "Documents"),
	path.join(os.homedir(), "Desktop"),
	path.join(os.homedir(), "Downloads"),
	path.join(os.homedir(), "Pictures"),
	path.join(os.homedir(), "Work"),
	path.join(os.homedir(), ".ssh"),
	path.join(os.homedir(), ".config"),
	path.join(os.homedir(), ".local"),
	path.join(os.homedir(), ".gnupg"),
];

// --- Types ---

type Threat = {
	description: string;
	severity: "critical" | "high" | "medium";
	paths: string[];
};

// --- Path Utilities ---

function resolvePath({
	targetPath,
	cwd,
}: {
	targetPath: string;
	cwd: string;
}): string {
	let resolved = targetPath;

	// Expand ~ to home directory
	if (resolved.startsWith("~/") || resolved === "~") {
		resolved = resolved.replace("~", os.homedir());
	}

	// Expand common env vars
	resolved = resolved.replace(/\$HOME/g, os.homedir());
	resolved = resolved.replace(/\$\{HOME\}/g, os.homedir());

	return path.resolve(cwd, resolved);
}

function isProtectedPath({
	targetPath,
	cwd,
}: {
	targetPath: string;
	cwd: string;
}): boolean {
	const resolved = resolvePath({ targetPath, cwd });

	for (const protectedPath of PROTECTED_PATHS) {
		// Exact match or the target IS a parent of a protected path
		if (resolved === protectedPath) return true;

		// Target is a parent of a protected path (deleting it would destroy the protected path)
		if (protectedPath.startsWith(resolved + "/")) return true;
	}

	return false;
}

function hasWildcardExplosion({ targetPath }: { targetPath: string }): boolean {
	// Patterns like /*, ~/*, ./* at the root of dangerous locations
	const isDangerousGlob =
		targetPath === "/*" ||
		targetPath === "~/*" ||
		targetPath === "$HOME/*" ||
		targetPath === "${HOME}/*" ||
		targetPath === "../*";

	// Recursive glob from a shallow path
	const isDeepGlob = /^(\/|~\/|\.\.\/)[^/]*\*/.test(targetPath);

	return isDangerousGlob || isDeepGlob;
}

function getPathSize({ targetPath }: { targetPath: string }): number {
	try {
		const stat = fs.statSync(targetPath);

		if (stat.isFile()) {
			return stat.size;
		}

		if (stat.isDirectory()) {
			try {
				const result = child_process.execSync(
					`du -s "${targetPath}" 2>/dev/null`,
					{
						encoding: "utf-8",
						timeout: 10000,
					},
				);
				const sizeKb = parseInt(result.split("\t")[0], 10);
				return sizeKb * 1024;
			} catch {
				return 0;
			}
		}
	} catch {
		return 0;
	}
	return 0;
}

function formatBytes({ bytes }: { bytes: number }): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

// --- Command Parsing ---

/**
 * Strip sudo prefix from a command so we can analyze the actual operation.
 * sudo makes everything worse, so we flag it separately.
 */
function stripSudo({ command }: { command: string }): {
	command: string;
	hasSudo: boolean;
} {
	const sudoPattern = /^sudo\s+(?:-[a-zA-Z]*\s+)*/;
	const match = command.match(sudoPattern);
	if (match) {
		return { command: command.slice(match[0].length), hasSudo: true };
	}
	return { command, hasSudo: false };
}

/**
 * Extract arguments from a command, filtering out flags.
 * Handles quoted strings.
 */
function extractArgs({ argsString }: { argsString: string }): string[] {
	const args: string[] = [];
	// Simple tokenizer that respects quotes
	const tokens = argsString.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

	for (const token of tokens) {
		// Skip flags
		if (token.startsWith("-")) continue;
		// Strip quotes
		args.push(token.replace(/^["']|["']$/g, ""));
	}

	return args;
}

/**
 * Splits a command string into individual commands separated by &&, ||, ;, or |.
 * Handles quoted strings so we do not split inside them.
 */
function splitCommands({ command }: { command: string }): string[] {
	const commands: string[] = [];
	let current = "";
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let i = 0;

	while (i < command.length) {
		const char = command[i];
		const next = command[i + 1];

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			current += char;
			i++;
			continue;
		}

		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			current += char;
			i++;
			continue;
		}

		if (inSingleQuote || inDoubleQuote) {
			current += char;
			i++;
			continue;
		}

		// Command separators
		if (
			char === ";" ||
			char === "|" ||
			(char === "&" && next === "&") ||
			(char === "|" && next === "|")
		) {
			if (current.trim()) commands.push(current.trim());
			current = "";
			// Skip double-char operators
			if ((char === "&" && next === "&") || (char === "|" && next === "|")) i++;
			i++;
			continue;
		}

		current += char;
		i++;
	}

	if (current.trim()) commands.push(current.trim());
	return commands;
}

// --- Threat Detectors ---

function detectRmThreats({
	command,
	cwd,
}: {
	command: string;
	cwd: string;
}): Threat[] {
	const threats: Threat[] = [];

	// Match rm/rmdir with various flag patterns
	const rmPattern = /\b(rm|rmdir)\s+((?:-[a-zA-Z]+\s+)*)(.*)/;
	const match = command.match(rmPattern);
	if (!match) return threats;

	const flags = match[2] || "";
	const isRecursive = /r/.test(flags) || /R/.test(flags);
	const isForced = /f/.test(flags);
	const argsString = match[3];
	const targets = extractArgs({ argsString });

	for (const target of targets) {
		// Wildcard explosion check
		if (hasWildcardExplosion({ targetPath: target })) {
			threats.push({
				description: `Wildcard deletion: rm ${flags}${target}`,
				severity: "critical",
				paths: [target],
			});
			continue;
		}

		const resolved = resolvePath({ targetPath: target, cwd });

		// Protected path check
		if (isProtectedPath({ targetPath: target, cwd })) {
			threats.push({
				description: `Deletion targets protected path: ${resolved}`,
				severity: "critical",
				paths: [resolved],
			});
			continue;
		}

		// Recursive + force on existing directory = check size
		if (isRecursive) {
			const size = getPathSize({ targetPath: resolved });
			if (size >= SIZE_THRESHOLD) {
				threats.push({
					description: `Large recursive deletion: ${resolved} (${formatBytes({ bytes: size })})`,
					severity: "high",
					paths: [resolved],
				});
			}
		}
	}

	return threats;
}

function detectFindDeleteThreats({
	command,
	cwd,
}: {
	command: string;
	cwd: string;
}): Threat[] {
	const threats: Threat[] = [];

	// find ... -delete or find ... -exec rm
	const isFindDelete =
		/\bfind\b/.test(command) &&
		(/\s-delete\b/.test(command) || /\s-exec\s+rm\b/.test(command));
	if (!isFindDelete) return threats;

	// Extract the search root from find
	const findMatch = command.match(/\bfind\s+(\S+)/);
	const searchRoot = findMatch ? findMatch[1] : ".";
	const resolved = resolvePath({ targetPath: searchRoot, cwd });

	if (isProtectedPath({ targetPath: searchRoot, cwd })) {
		threats.push({
			description: `find -delete rooted at protected path: ${resolved}`,
			severity: "critical",
			paths: [resolved],
		});
	} else {
		const size = getPathSize({ targetPath: resolved });
		if (size >= SIZE_THRESHOLD) {
			threats.push({
				description: `find -delete in large directory: ${resolved} (${formatBytes({ bytes: size })})`,
				severity: "high",
				paths: [resolved],
			});
		}
	}

	return threats;
}

function detectChmodChownThreats({
	command,
	cwd,
}: {
	command: string;
	cwd: string;
}): Threat[] {
	const threats: Threat[] = [];

	const match = command.match(/\b(chmod|chown)\s+((?:-[a-zA-Z]+\s+)*)(.*)/);
	if (!match) return threats;

	const flags = match[2] || "";
	const isRecursive = /R/.test(flags) || /r/.test(flags);
	if (!isRecursive) return threats;

	const targets = extractArgs({ argsString: match[3] });
	// For chmod/chown, the first non-flag arg is the mode/owner, rest are paths
	// Skip the first arg (mode like 777 or owner like root:root)
	const paths = targets.slice(1);

	for (const target of paths) {
		if (isProtectedPath({ targetPath: target, cwd })) {
			threats.push({
				description: `Recursive ${match[1]} on protected path: ${resolvePath({ targetPath: target, cwd })}`,
				severity: "critical",
				paths: [resolvePath({ targetPath: target, cwd })],
			});
		}
	}

	return threats;
}

function detectGitCleanThreats({ command }: { command: string }): Threat[] {
	const threats: Threat[] = [];

	// git clean -fdx or similar aggressive clean
	const match = command.match(/\bgit\s+clean\b\s+((?:-[a-zA-Z]+\s*)*)/);
	if (!match) return threats;

	const flags = match[1] || "";
	const isForced = /f/.test(flags);
	const isDirectories = /d/.test(flags);
	const isIgnored = /x/.test(flags) || /X/.test(flags);

	if (isForced && (isDirectories || isIgnored)) {
		threats.push({
			description: `Aggressive git clean (${flags.trim()}) -- will permanently delete untracked${isIgnored ? " and gitignored" : ""} files${isDirectories ? " and directories" : ""}`,
			severity: "high",
			paths: ["."],
		});
	}

	return threats;
}

function detectPipedDeletionThreats({
	command,
}: {
	command: string;
}): Threat[] {
	const threats: Threat[] = [];

	// xargs rm, xargs del, etc.
	if (/\|\s*xargs\s+(?:.*\s)?rm\b/.test(command)) {
		threats.push({
			description: "Piped deletion via xargs rm -- uncontrolled scope",
			severity: "high",
			paths: ["(piped input)"],
		});
	}

	return threats;
}

function detectTruncationThreats({
	command,
	cwd,
}: {
	command: string;
	cwd: string;
}): Threat[] {
	const threats: Threat[] = [];

	// > file (redirect that truncates)
	// Only catch bare redirections at the start, not echo "x" > file (which is intentional writes)
	const truncateRedirect = command.match(/^>\s*(\S+)/);
	if (truncateRedirect) {
		const target = truncateRedirect[1];
		const resolved = resolvePath({ targetPath: target, cwd });
		if (isProtectedPath({ targetPath: target, cwd })) {
			threats.push({
				description: `Truncation of protected file: ${resolved}`,
				severity: "critical",
				paths: [resolved],
			});
		}
	}

	// truncate command
	const truncateCmd = command.match(/\btruncate\b.*?(?:-s\s*\d+\s+)?(\S+)/);
	if (truncateCmd) {
		const target = truncateCmd[1];
		const resolved = resolvePath({ targetPath: target, cwd });
		const size = getPathSize({ targetPath: resolved });
		if (size >= SIZE_THRESHOLD) {
			threats.push({
				description: `Truncating large file: ${resolved} (${formatBytes({ bytes: size })})`,
				severity: "high",
				paths: [resolved],
			});
		}
	}

	return threats;
}

function detectDeviceThreats({ command }: { command: string }): Threat[] {
	const threats: Threat[] = [];

	// dd writing to a device
	if (/\bdd\b/.test(command) && /\bof=\/dev\//.test(command)) {
		threats.push({
			description: "dd writing directly to a device",
			severity: "critical",
			paths: ["(device)"],
		});
	}

	// mkfs / format
	if (/\b(mkfs|newfs|format)\b/.test(command)) {
		threats.push({
			description: "Filesystem format command detected",
			severity: "critical",
			paths: ["(device)"],
		});
	}

	// mv to /dev/null
	if (/\bmv\b/.test(command) && /\/dev\/null/.test(command)) {
		threats.push({
			description: "mv to /dev/null -- data will be destroyed",
			severity: "high",
			paths: ["/dev/null"],
		});
	}

	return threats;
}

// --- Main Analysis ---

function analyzeCommand({
	command,
	cwd,
}: {
	command: string;
	cwd: string;
}): Threat[] {
	const allThreats: Threat[] = [];

	// Pipe-aware detectors must run on the full command before splitting,
	// since splitCommands breaks on | and the pipe context is lost.
	allThreats.push(...detectPipedDeletionThreats({ command }));

	const subcommands = splitCommands({ command });

	for (const sub of subcommands) {
		const { command: stripped, hasSudo } = stripSudo({ command: sub });

		const detectors = [
			detectRmThreats,
			detectFindDeleteThreats,
			detectChmodChownThreats,
			detectGitCleanThreats,
			detectTruncationThreats,
			detectDeviceThreats,
		];

		for (const detect of detectors) {
			const threats = detect({ command: stripped, cwd });

			// Escalate severity if sudo is involved
			if (hasSudo) {
				for (const threat of threats) {
					threat.description = `[sudo] ${threat.description}`;
					threat.severity = "critical";
				}
			}

			allThreats.push(...threats);
		}
	}

	return allThreats;
}

// --- Formatting ---

function formatThreats({ threats }: { threats: Threat[] }): string {
	const severityOrder: Record<string, number> = {
		critical: 0,
		high: 1,
		medium: 2,
	};
	const sorted = [...threats].sort(
		(a, b) =>
			(severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
	);

	const lines: string[] = [];

	for (const threat of sorted) {
		const tag =
			threat.severity === "critical"
				? "[CRITICAL]"
				: threat.severity === "high"
					? "[HIGH]"
					: "[MEDIUM]";

		lines.push(`${tag} ${threat.description}`);
	}

	return lines.join("\n");
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		if (!ctx.hasUI) return;

		const threats = analyzeCommand({
			command: event.input.command,
			cwd: ctx.cwd,
		});

		if (threats.length === 0) return;

		const hasCritical = threats.some((t) => t.severity === "critical");
		const title = hasCritical
			? "CRITICAL: Destructive command detected"
			: "Destructive command detected";

		const body = `${formatThreats({ threats })}\n\nCommand:\n  ${event.input.command}\n\nAllow this command to run?`;

		const isConfirmed = await ctx.ui.confirm(title, body);

		if (!isConfirmed) {
			return {
				block: true,
				reason: `User blocked destructive command.\n${formatThreats({ threats })}`,
			};
		}
	});
}
