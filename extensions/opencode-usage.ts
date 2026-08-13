/**
 * opencode-usage extension
 *
 * Adds a /usage command that queries the opencode zen usage endpoint and
 * reports rolling, weekly, and monthly consumption. The API key is resolved
 * through pi's model registry (no auth files are read directly).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "opencode-go";
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

type UsageWindow = {
	status: string;
	percent: number;
	resetsAt: string;
};

type UsageResponse = {
	usage: {
		rolling: UsageWindow;
		weekly: UsageWindow;
		monthly: UsageWindow;
	};
};

function formatResetsAt({ iso }: { iso: string }): string {
	const ms = new Date(iso).getTime() - Date.now();
	if (Number.isNaN(ms)) return iso;
	const days = Math.max(0, Math.ceil(ms / 86_400_000));
	return days === 0 ? "today" : "in " + days + "d";
}

function formatWindow({ name, window }: { name: string; window: UsageWindow }): string {
	const status = window.status && window.status !== "ok" ? " [" + window.status + "]" : "";
	return name.padEnd(8) + " " + String(window.percent).padStart(3) + "%" + status + "  resets " + formatResetsAt({ iso: window.resetsAt });
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Query opencode zen usage (rolling/weekly/monthly)",
		handler: async (_args, ctx) => {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
			if (!apiKey) {
				ctx.ui.notify(
					"No API key configured for \"" + PROVIDER + "\". Set it in pi auth first.",
					"error",
				);
				return;
			}

			let response: Response;
			try {
				response = await fetch(USAGE_URL, {
					headers: { Authorization: "Bearer " + apiKey },
				});
			} catch (error) {
				ctx.ui.notify(
					"Usage query failed: " + (error instanceof Error ? error.message : String(error)),
					"error",
				);
				return;
			}

			if (!response.ok) {
				ctx.ui.notify("Usage query failed: HTTP " + response.status, "error");
				return;
			}

			let data: UsageResponse;
			try {
				data = (await response.json()) as UsageResponse;
			} catch {
				ctx.ui.notify("Usage query failed: invalid response", "error");
				return;
			}

			if (!data.usage) {
				ctx.ui.notify("Usage query failed: missing usage data", "error");
				return;
			}

			const { rolling, weekly, monthly } = data.usage;
			ctx.ui.notify(
				[
					"opencode zen usage",
					formatWindow({ name: "Rolling", window: rolling }),
					formatWindow({ name: "Weekly", window: weekly }),
					formatWindow({ name: "Monthly", window: monthly }),
				].join("\n"),
				"info",
			);
		},
	});
}
