/**
 * Thinking Stash Extension
 *
 * Captures reasoning/thinking tokens during streaming. When the user
 * interrupts the agent, the thinking can be re-injected into the next
 * turn via the /rethink command.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

const extractThinking = ({ content }: { content: unknown[] }): string => {
	const parts: string[] = [];
	for (const block of content) {
		const b = block as Record<string, unknown>;
		if (b.type === "thinking" && typeof b.thinking === "string") {
			parts.push(b.thinking);
		}
	}
	return parts.join("\n\n");
};

export default function thinkingStash(pi: ExtensionAPI) {
	let lastThinking: string | null = null;
	let currentThinking = "";
	let isArmed = false;

	const reset = (): void => {
		lastThinking = null;
		currentThinking = "";
		isArmed = false;
	};

	pi.on("message_update", async (event) => {
		const msg = event.message;
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			const thinking = extractThinking({ content: msg.content });
			if (thinking) {
				currentThinking = thinking;
			}
		}
	});

	pi.on("agent_end", async () => {
		if (currentThinking) {
			lastThinking = currentThinking;
		}
		currentThinking = "";
	});

	pi.on("session_start", async () => {
		reset();
	});

	pi.on("session_switch", async () => {
		reset();
	});

	pi.registerMessageRenderer(
		"resumed-thinking",
		(message, options, theme) => {
			const { expanded } = options;
			const details = message.details as { lineCount?: number } | undefined;
			const lineCount = details?.lineCount ?? 0;

			let text = theme.fg("accent", "Thinking stash injected");
			text += theme.fg("dim", ` (${lineCount} lines)`);

			if (expanded && typeof message.content === "string") {
				text += "\n\n" + theme.fg("dim", message.content);
			}

			return new Text(text, 0, 0);
		},
	);

	pi.registerCommand("rethink", {
		description:
			"Re-inject thinking from the last response. Pass a prompt to send immediately.",
		handler: async (args, ctx) => {
			if (!lastThinking) {
				ctx.ui.notify("No captured thinking to inject.", "warning");
				return;
			}
			isArmed = true;
			const lineCount = lastThinking.split("\n").length;

			if (args && args.trim()) {
				ctx.ui.notify(`Injecting thinking (${lineCount} lines).`, "info");
				pi.sendUserMessage(args.trim());
			} else {
				ctx.ui.notify(
					`Thinking stashed (${lineCount} lines). Will inject on next turn.`,
					"info",
				);
			}
		},
	});

	pi.on("before_agent_start", async () => {
		if (isArmed && lastThinking) {
			isArmed = false;
			const thinking = lastThinking;
			lastThinking = null;
			return {
				message: {
					customType: "resumed-thinking",
					content: `Your previous response was interrupted. Here is the reasoning you had generated before the interruption. Resume from where you left off:\n\n${thinking}`,
					display: true,
					details: { lineCount: thinking.split("\n").length },
				},
			};
		}
	});
}
