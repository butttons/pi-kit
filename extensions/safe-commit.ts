/**
 * Safe Commit Extension
 *
 * Intercepts bash commands that perform git commits.
 * Prompts the user for confirmation before allowing the commit to proceed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

function isGitCommitCommand({ command }: { command: string }): boolean {
	const normalized = command.replace(/\s+/g, " ").trim();

	// Match: git commit, git -C ... commit, git commit -m, etc.
	// Exclude: git commit --amend (if you want), or keep it inclusive
	return /\bgit\b.*\bcommit\b/.test(normalized);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		if (!ctx.hasUI) return;

		if (!isGitCommitCommand({ command: event.input.command })) return;

		const choice = await ctx.ui.select(`Git commit: ${event.input.command}`, [
			"Allow",
			"Block",
		]);

		if (choice === "Allow") return;

		const feedback = await ctx.ui.input("Feedback (optional):", "");
		const reason = feedback?.trim()
			? `User blocked the git commit: ${feedback.trim()}`
			: "User blocked the git commit.";

		return { block: true, reason };
	});
}
