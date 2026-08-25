/**
 * Agent Watch Extension
 *
 * Periodically scans the subagent activity files for the current session
 * and injects a compact status message into the session whenever one or
 * more subagents are actively running. Each agent is reported with its
 * current turn index, activity sequence, and a stall counter that grows
 * on consecutive scans with an unchanged sequence — so the orchestrator
 * can tell at a glance which agents are progressing and which are stuck.
 *
 * Scans run every 5 minutes on an unref'd interval, torn down on session
 * shutdown. Every filesystem failure degrades silently: a failed scan is
 * skipped and never throws.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;
const SESSIONS_BASE = join(homedir(), ".pi", "agent", "sessions");

interface SubagentActivity {
	phase: string;
	sequence: number;
	turnIndex?: number;
	runningChildId: string;
	updatedAt: number;
}

interface AgentWatchState {
	lastSequence: number;
	stallCount: number;
}

/** cwd → session directory slug: /a/b/c → --a-b-c-- */
const sessionSlug = (cwd: string): string =>
	`--${cwd.replace(/\/+$/, "").slice(1).replaceAll("/", "-")}--`;

export default function agentWatch(pi: ExtensionAPI) {
	let timer: NodeJS.Timeout | null = null;
	let cwd: string | undefined;
	const agents = new Map<string, AgentWatchState>();

	const listActivityFiles = (): string[] => {
		const artifactsDir = join(SESSIONS_BASE, sessionSlug(cwd ?? ""), "artifacts");
		const files: string[] = [];
		for (const artifact of readdirSync(artifactsDir, { withFileTypes: true })) {
			if (!artifact.isDirectory()) continue;
			const activityDir = join(artifactsDir, artifact.name, "subagent-activity");
			let names: string[];
			try {
				names = readdirSync(activityDir);
			} catch {
				continue; // artifact without a subagent-activity dir
			}
			for (const name of names) {
				if (name.endsWith(".json")) {
					files.push(join(activityDir, name));
				}
			}
		}
		return files;
	};

	const scan = (): void => {
		try {
			const now = Date.now();
			const seen = new Set<string>();
			const lines: string[] = [];

			for (const file of listActivityFiles()) {
				try {
					const activity = JSON.parse(
						readFileSync(file, "utf8"),
					) as Partial<SubagentActivity>;
					if (activity.phase !== "active") continue;
					if (
						typeof activity.updatedAt !== "number" ||
						now - activity.updatedAt > ACTIVE_WINDOW_MS
					) {
						continue;
					}

					const id = activity.runningChildId ?? basename(file, ".json");
					seen.add(id);

					const sequence =
						typeof activity.sequence === "number" ? activity.sequence : 0;
					const turn =
						typeof activity.turnIndex === "number" ? activity.turnIndex : 0;

					let stall = 0;
					const prior = agents.get(id);
					if (prior) {
						stall = prior.lastSequence === sequence ? prior.stallCount + 1 : 0;
					}
					agents.set(id, { lastSequence: sequence, stallCount: stall });

					lines.push(
						`[agent-watch] ${id.slice(0, 8)}:turn${turn}:seq${sequence}:stall${stall}`,
					);
				} catch {
					continue; // unreadable or corrupt activity file — skip it
				}
			}

			// Drop agents that are no longer active so their stall
			// counters restart on a fresh activity window.
			for (const id of agents.keys()) {
				if (!seen.has(id)) {
					agents.delete(id);
				}
			}

			if (lines.length > 0) {
				pi.sendUserMessage(lines.join(" "), { deliverAs: "followUp" });
			}
		} catch {
			// Any fs error during the scan — skip this cycle silently.
		}
	};

	const stop = (): void => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		agents.clear();
		stop();
		timer = setInterval(scan, SCAN_INTERVAL_MS);
		timer.unref();
	});

	pi.on("session_shutdown", () => {
		stop();
	});
}
