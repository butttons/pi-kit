/**
 * Custom Footer
 *
 * Replaces the default dense statusline with a cleaner layout.
 * Includes model, token stats, cost, context bar, and git branch.
 */

import { execSync } from "node:child_process";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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
		ctx.ui.setFooter((tui: Tui, theme: Theme, footerData: FooterData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const fmt = (n: number) =>
						n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;

					// Token stats
					let input = 0;
					let output = 0;
					let cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cost += m.usage.cost.total;
						}
					}

					// Context usage bar
					const usage = ctx.getContextUsage();
					const pct = usage ? Math.round(usage.percent) : 0;
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
					const statsStr = theme.fg("muted", `${fmt(input)}/${fmt(output)}`);
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

					// Right: extension statuses | branch
					const rightParts: string[] = [];
					if (extStr) rightParts.push(extStr);
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
