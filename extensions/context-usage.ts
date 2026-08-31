/**
 * Custom Footer
 *
 * Replaces the default dense statusline with a cleaner layout.
 * Includes model, token stats, cost, context bar, project name, and git branch.
 */

import { execSync } from "node:child_process";
import { basename } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	calculateContextTokens,
	estimateTokens,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const FOLD_MARKER_TYPE = "fold-marker";

/** Index of the latest fold-marker entry on the branch, or -1 if none. */
function findFoldCutoff(
	branch: Array<{ type: string; customType?: string }>,
): number {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (
			entry.type === "custom_message" &&
			entry.customType === FOLD_MARKER_TYPE
		) {
			return i;
		}
	}
	return -1;
}

/**
 * Estimate context tokens the way pi core does (real usage from the last
 * valid assistant response, otherwise a per-message estimate), but over the
 * post-fold messages only. pi core's getContextUsage() sees the unfiltered
 * message list, so it can't account for /fold's context filter.
 */
function postFoldContextTokens(messages: AgentMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as AssistantMessage;
		if (msg.role !== "assistant") continue;
		if (
			msg.stopReason === "aborted" ||
			msg.stopReason === "error" ||
			!msg.usage ||
			calculateContextTokens(msg.usage) <= 0
		) {
			break; // last assistant is invalid — fall through to estimate
		}
		return calculateContextTokens(msg.usage);
	}
	return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

type Theme = {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
};

type FooterData = {
	getGitBranch: () => string | null;
	getExtensionStatuses: () => ReadonlyMap<string, string>;
	onBranchChange: (cb: () => void) => () => void;
};

type Tui = {
	requestRender: () => void;
};

function isGitDirty(): boolean {
	try {
		const out = execSync("git status --porcelain", {
			timeout: 2000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return out.toString().trim().length > 0;
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ctx type varies across event handlers
	function setupFooter(ctx: any) {
		const projectName = basename(ctx.cwd);

		ctx.ui.setFooter((tui: Tui, theme: Theme, footerData: FooterData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const fmt = (n: number) =>
						n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;

					// Token stats
					// ↑ input: tokens sent to the LLM on the last turn (post-fold
					// context), with the % served from the provider cache
					// ↓ output: cumulative tokens generated this session
					let input = 0;
					let cachedPct: number | null = null;
					let output = 0;
					let cost = 0;
					const branchEntries = ctx.sessionManager.getBranch();
					const cutoff = findFoldCutoff(branchEntries);
					for (const e of branchEntries) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							output += m.usage.output;
							cost += m.usage.cost.total;
						}
					}
					for (let i = branchEntries.length - 1; i > cutoff; i--) {
						const e = branchEntries[i];
						if (e.type !== "message" || e.message.role !== "assistant")
							continue;
						const m = e.message as AssistantMessage;
						if (
							m.stopReason === "aborted" ||
							m.stopReason === "error" ||
							!m.usage ||
							m.usage.input + m.usage.output <= 0
						) {
							break;
						}
						const u = m.usage;
						input = u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
						const totalIn = input;
						cachedPct =
							totalIn > 0
								? Math.round(((u.cacheRead ?? 0) / totalIn) * 100)
								: null;
						break;
					}

					// Context usage bar — computed over post-fold messages so the
					// bar drops after /fold (pi core's getContextUsage() ignores
					// extension context filters)
					let pct = 0;
					if (ctx.model && ctx.model.contextWindow > 0) {
						const branch = ctx.sessionManager.getBranch();
						const cutoff = findFoldCutoff(branch);
						const postFoldMessages = branch
							.slice(cutoff + 1)
							.filter((e: { type: string }) => e.type === "message")
							.map((e: { message: AgentMessage }) => e.message);
						const tokens = postFoldContextTokens(postFoldMessages);
						pct = Math.round((tokens / ctx.model.contextWindow) * 100);
					}
					const barWidth = 10;
					const filled = Math.round((pct / 100) * barWidth);
					const empty = barWidth - filled;
					const barColor =
						pct >= 90 ? "error" : pct >= 70 ? "warning" : "success";
					const bar =
						theme.fg(barColor, "\u2588".repeat(filled)) +
						theme.fg("dim", "\u2591".repeat(empty));
					const barLabel = theme.fg(pct >= 90 ? "error" : "dim", `${pct}%`);

					// Sections
					const modelStr = theme.fg("accent", ctx.model?.id ?? "no model");
					const statsStr =
						theme.fg("muted", `↑${fmt(input)}`) +
						(cachedPct !== null
							? theme.fg("dim", ` ${cachedPct}%`)
							: "") +
						theme.fg("muted", ` ↓${fmt(output)}`);
					const costStr = theme.fg("dim", `$${cost.toFixed(2)}`);
					const contextStr = `${bar} ${barLabel}`;

					const branch = footerData.getGitBranch();
					const isDirty = branch ? isGitDirty() : false;
					const branchStr = branch
						? theme.fg("dim", branch) +
							(isDirty ? theme.fg("warning", " *") : "")
						: "";

					// Extension statuses (from other extensions)
					const extStatuses = footerData.getExtensionStatuses();
					const extParts: string[] = [];
					for (const [, val] of extStatuses) {
						extParts.push(val);
					}
					const extStr = extParts.join(theme.fg("dim", " | "));

					const sep = theme.fg("dim", " | ");

					// Left: model | tokens | cost | context bar
					const left = [modelStr, statsStr, costStr, contextStr].join(sep);

					// Right: extension statuses | project | branch
					const projectStr = theme.fg("accent", projectName);

					const rightParts: string[] = [];
					if (extStr) rightParts.push(extStr);
					rightParts.push(projectStr);
					if (branchStr) rightParts.push(branchStr);
					const right = rightParts.join(sep);

					const gap = width - visibleWidth(left) - visibleWidth(right);
					const pad = " ".repeat(Math.max(1, gap));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		setupFooter(ctx);
	});
}
