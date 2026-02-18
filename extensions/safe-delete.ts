/**
 * Safe Delete Extension
 *
 * Intercepts bash commands that delete files. If the deletion target
 * exceeds 100MB, prompts the user for confirmation before proceeding.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";

function getDeleteTargets({ command }: { command: string }): string[] {
	const targets: string[] = [];

	// Match rm commands (rm, rm -rf, rm -f, rm -r, etc.)
	const rmPattern = /\brm\s+(?:-[a-zA-Z]*\s+)*(.+)/g;
	let match: RegExpExecArray | null;
	while ((match = rmPattern.exec(command)) !== null) {
		const args = match[1].trim();
		// Split on spaces but respect quotes
		const paths = args
			.split(/\s+/)
			.filter((p) => !p.startsWith("-"))
			.map((p) => p.replace(/^["']|["']$/g, ""));
		targets.push(...paths);
	}

	return targets;
}

function getPathSize({ targetPath }: { targetPath: string }): number {
	try {
		const resolved = path.resolve(targetPath);
		const stat = fs.statSync(resolved);

		if (stat.isFile()) {
			return stat.size;
		}

		if (stat.isDirectory()) {
			try {
				const result = child_process.execSync(`du -s "${resolved}" 2>/dev/null`, {
					encoding: "utf-8",
					timeout: 10000,
				});
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
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

const SIZE_THRESHOLD = 100 * 1024 * 1024; // 100MB

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		if (!ctx.hasUI) return;

		const targets = getDeleteTargets({ command: event.input.command });
		if (targets.length === 0) return;

		const largeTargets: Array<{ path: string; size: number }> = [];

		for (const target of targets) {
			const size = getPathSize({ targetPath: target });
			if (size >= SIZE_THRESHOLD) {
				largeTargets.push({ path: target, size });
			}
		}

		if (largeTargets.length === 0) return;

		const details = largeTargets
			.map((t) => `  ${t.path} (${formatBytes({ bytes: t.size })})`)
			.join("\n");

		const isConfirmed = await ctx.ui.confirm(
			"Large deletion detected",
			`The following targets are over 100MB:\n${details}\n\nAllow this deletion?`,
		);

		if (!isConfirmed) {
			return { block: true, reason: `User blocked deletion of large files:\n${details}` };
		}
	});
}
