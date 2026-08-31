/**
 * Fold Extension
 *
 * Folds conversation history into a single sentinel marker to keep context
 * manageable as conversations grow.
 *
 * Usage:
 *   /fold                - fold all current messages into the sentinel
 *   /fold <label>        - fold with a descriptive label
 *
 * When folded, all existing messages are hidden from the LLM context and
 * replaced by a single sentinel marker message. The conversation continues
 * normally after the marker. Each subsequent fold updates the sentinel
 * (the accumulated count grows, but only one marker is visible to the LLM).
 *
 * The get_folded_message tool lets the LLM retrieve any folded content on
 * demand.
 *
 * Caching: the /fold command only affects the context event filter. When no
 * fold markers are present, the context event passes through unchanged, so
 * provider-side caching is unaffected. Caching is only busted when the LLM
 * has an active sentinel, at which point the message sequence itself changes.
 */

import type { AgentMessage, AgentToolCall } from "@earendil-works/pi-agent-core";
import type {
	AssistantMessage,
	TextContent,
	ToolResultMessage,
	UserMessage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	truncateTail,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

/** Shape of a bash-execution message (not exported from pi-ai). */
type BashExecMessage = {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	timestamp: number;
};

// --- Constants ---

const FOLD_ENTRY_TYPE = "fold";
const FOLD_MARKER_TYPE = "fold-marker";

// --- Types ---

/** Normalized representation of a single message stored in a fold entry. */
type FoldedMessage = {
	role: "user" | "assistant" | "toolResult" | "bashExecution";
	timestamp: number;
	/** Plain text content (text blocks only, no images/thinking/toolCalls). */
	content: string;
	/** Which fold operation this message belongs to (1 = first fold, etc.). */
	foldNumber: number;
	/** Thinking blocks from assistant messages, if any. */
	thinking?: string;
	/** Tool calls from assistant messages, if any. */
	toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
	/** Usage metadata from assistant messages, if any. */
	usage?: {
		input: number;
		output: number;
		total: number;
		cost?: number;
	};
	/** For tool-result messages. */
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	/** For bash-execution messages. */
	command?: string;
	exitCode?: number;
};

/** Data stored in each fold CustomEntry. */
type FoldEntryData = {
	foldNumber: number;
	messageCount: number;
	label?: string;
	createdAt: number;
	messages: FoldedMessage[];
};

/** Details attached to the fold-marker custom message. */
type FoldMarkerDetails = {
	foldNumber: number;
	totalFolded: number;
	foldsCount: number;
	label?: string;
	createdAt: number;
};

// --- State ---

let foldCount = 0;
let totalFolded = 0;

// --- Helpers ---

/** Extract plain text from message content (string or content blocks). */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(b): b is TextContent =>
					typeof b === "object" && b !== null && b.type === "text",
			)
			.map((b) => b.text ?? "")
			.join("\n");
	}
	return "";
}

/** Serialize an AgentMessage into a compact, JSON-safe FoldedMessage. */
function serializeMessage(message: AgentMessage): FoldedMessage | null {
	if (message.role === "user") {
		const user = message as UserMessage;
		return {
			role: "user",
			timestamp: user.timestamp,
			content: extractText(user.content),
			foldNumber: 0, // assigned by caller
		};
	}

	if (message.role === "assistant") {
		const assistant = message as AssistantMessage;
		const text = extractText(assistant.content);
		const thinking = assistant.content
			.filter(
				(b): b is { type: "thinking"; thinking: string } =>
					typeof b === "object" && b !== null && b.type === "thinking",
			)
			.map((b) => b.thinking)
			.join("\n\n");

		const toolCalls = assistant.content
			.filter(
				(b): b is AgentToolCall =>
					typeof b === "object" && b !== null && b.type === "toolCall",
			)
			.map((b) => ({
				name: b.name,
				arguments: b.arguments as Record<string, unknown>,
			}));

		const usage = assistant.usage
			? {
					input: assistant.usage.input,
					output: assistant.usage.output,
					total: assistant.usage.totalTokens,
					cost: assistant.usage.cost?.total,
				}
			: undefined;

		return {
			role: "assistant",
			timestamp: assistant.timestamp,
			content: text,
			foldNumber: 0, // assigned by caller
			thinking: thinking || undefined,
			toolCalls: toolCalls.length ? toolCalls : undefined,
			usage,
		};
	}

	if (message.role === "toolResult") {
		const toolMsg = message as ToolResultMessage;
		return {
			role: "toolResult",
			timestamp: toolMsg.timestamp,
			content: extractText(toolMsg.content),
			foldNumber: 0, // assigned by caller
			toolCallId: toolMsg.toolCallId,
			toolName: toolMsg.toolName,
			isError: toolMsg.isError,
		};
	}

	if (message.role === "bashExecution") {
		const bashMsg = message as unknown as BashExecMessage;
		return {
			role: "bashExecution",
			timestamp: bashMsg.timestamp ?? 0,
			content: bashMsg.output ?? "",
			foldNumber: 0, // assigned by caller
			command: bashMsg.command,
			exitCode: bashMsg.exitCode,
		};
	}

	// Skip custom messages (incl. previous fold-markers), branch summaries,
	// compaction summaries — they are not "real" conversation messages.
	return null;
}

/** Find the index of the latest fold-marker in a message array. */
function findLatestFoldMarker(messages: AgentMessage[]): number {
	let latest = -1;
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "custom") {
			const custom = msg as { customType?: string };
			if (custom.customType === FOLD_MARKER_TYPE) {
				latest = i;
			}
		}
	}
	return latest;
}

/** Format a single folded message for tool output. */
function formatFoldedMessage(msg: FoldedMessage): string {
	const timeStr = new Date(msg.timestamp).toISOString();
	let out = `\n[Fold #${msg.foldNumber}] [${msg.role.toUpperCase()}] ${timeStr}`;

	if (msg.content) {
		out += `\n${msg.content}`;
	}

	if (msg.thinking) {
		out += `\n\n<thinking>\n${msg.thinking}\n</thinking>`;
	}

	if (msg.toolCalls && msg.toolCalls.length > 0) {
		for (const tc of msg.toolCalls) {
			out += `\n\n[TOOL CALL: ${tc.name}]`;
			if (Object.keys(tc.arguments).length > 0) {
				out += `\n${JSON.stringify(tc.arguments, null, 2)}`;
			}
		}
	}

	if (msg.toolCallId && msg.role === "toolResult") {
		out += `\n[tool: ${msg.toolName ?? "unknown"}]`;
		if (msg.isError) out += ` [ERROR]`;
	}

	if (msg.usage) {
		out += `\n[usage: ${msg.usage.input}/${msg.usage.output}/${msg.usage.total} tokens`;
		if (msg.usage.cost !== undefined) {
			out += `, $${msg.usage.cost.toFixed(2)}`;
		}
		out += `]`;
	}

	if (msg.command) {
		out += `\n[bash: ${msg.command}]`;
		if (msg.exitCode !== undefined) {
			out += ` [exit: ${msg.exitCode}]`;
		}
	}

	return out;
}

// --- Extension ---

export default function foldExtension(pi: ExtensionAPI): void {
	// --- Reconstruct state on session start/resume ---

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();

		foldCount = 0;
		totalFolded = 0;

		for (const entry of entries) {
			if (
				entry.type === "custom" &&
				(entry as { customType?: string }).customType === FOLD_ENTRY_TYPE
			) {
				const data = (entry as { data?: FoldEntryData }).data;
				if (data) {
					foldCount++;
					totalFolded += data.messageCount || 0;
				}
			}
		}

		if (foldCount > 0) {
			ctx.ui.setStatus(
				"fold",
				`${totalFolded} folded (${foldCount} fold${foldCount === 1 ? "" : "s"})`,
			);
		} else {
			ctx.ui.setStatus("fold", undefined);
		}
	});

	// --- Filter folded messages from LLM context ---
	// Only the latest sentinel marker (and messages after it) reach the LLM.
	// When no markers exist, messages pass through unchanged (cache preserved).

	pi.on("context", async (event) => {
		const markerIndex = findLatestFoldMarker(event.messages);
		if (markerIndex <= 0) return; // no marker, or marker at position 0 (nothing before it)

		return {
			messages: event.messages.slice(markerIndex),
		};
	});

	// --- Sentinel marker renderer ---

	pi.registerMessageRenderer(FOLD_MARKER_TYPE, (message, options, theme) => {
		const details = message.details as FoldMarkerDetails | undefined;
		const { expanded } = options;

		let text = theme.fg("accent", "📁 Folded Messages");

		if (details) {
			const count = details.totalFolded ?? 0;
			const folds = details.foldsCount ?? 0;
			text += theme.fg("dim", ` — ${count} message${count === 1 ? "" : "s"} · ${folds} fold${folds === 1 ? "" : "s"}`);
			if (details.label) {
				text += theme.fg("muted", ` · "${details.label}"`);
			}
		}

		text += theme.fg("dim", ` — get_folded_message to retrieve`);

		if (expanded && typeof message.content === "string") {
			text += "\n\n" + theme.fg("dim", message.content);
		}

		return new Text(text, 0, 0);
	});

	// --- search_folded tool (structured search, truncated previews only) ---

	pi.registerTool(
		{
			name: "search_folded",
			label: "Search Folded Messages",
			description: [
				"Search messages that were folded away by /fold. Returns structured hits with",
				"stable ids and TRUNCATED previews — never full content.",
				"",
				"- foldIndex: search within one fold (1 = first fold). Omit to search all folds.",
				"- searchText: case-insensitive substring match on message content.",
				"- role: filter by role (user, assistant, tool).",
				"- limit: max hits to return, most recent first. Default 20.",
				"",
				"To read one full message, pass its id to get_folded_message.",
			].join("\n"),
			parameters: Type.Object({
				foldIndex: Type.Optional(
					Type.Integer({
						description:
							"Fold to search (1 = first fold). Omit to search all folds.",
						minimum: 1,
					}),
				),
				searchText: Type.Optional(
					Type.String({
						description:
							"Case-insensitive substring to match. Whitespace-only is ignored.",
					}),
				),
				role: Type.Optional(
					Type.Union([
						Type.Literal("user"),
						Type.Literal("assistant"),
						Type.Literal("tool"),
					]),
				),
				limit: Type.Optional(
					Type.Integer({ description: "Max hits (default 20).", minimum: 1, maximum: 100 }),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const entries = ctx.sessionManager.getBranch();
				const foldEntries: FoldEntryData[] = [];
				for (const entry of entries) {
					if (
						entry.type === "custom" &&
						(entry as { customType?: string }).customType ===
							FOLD_ENTRY_TYPE
					) {
						const data = (entry as { data?: FoldEntryData }).data;
						if (data && data.messages) foldEntries.push(data);
					}
				}

				if (foldEntries.length === 0) {
					return {
						content: [{ type: "text", text: "No folded messages. Use /fold to fold history." }],
						details: {},
					};
				}

				// Bare call: per-fold overview, no message content.
				const hasText =
					typeof params.searchText === "string" &&
					params.searchText.trim().length > 0;
				if (
					params.foldIndex === undefined &&
					!hasText &&
					params.role === undefined
				) {
					let overview = `Folded message overview — ${foldEntries.length} fold${foldEntries.length === 1 ? "" : "s"}. Pass foldIndex and/or searchText to search; pass an id to get_folded_message for full content.`;
					for (const f of foldEntries) {
						const roles: Record<string, number> = {};
						for (const m of f.messages) roles[m.role] = (roles[m.role] ?? 0) + 1;
						const roleStr = Object.entries(roles).map(([r, n]) => `${r}:${n}`).join(" ");
						overview += `\n- Fold #${f.foldNumber}${f.label ? ` "${f.label}"` : ""}: ${f.messageCount} messages (${roleStr})`;
					}
					return { content: [{ type: "text", text: overview }], details: {} };
				}

				// Collect candidates
				type Hit = { id: string; msg: FoldedMessage; foldNumber: number; index: number };
				let hits: Hit[] = [];
				for (const f of foldEntries) {
					if (params.foldIndex !== undefined && f.foldNumber !== params.foldIndex) continue;
					f.messages.forEach((m, i) => {
						hits.push({ id: `${f.foldNumber}:${i}`, msg: m, foldNumber: f.foldNumber, index: i });
					});
				}

				if (params.role) {
					hits = hits.filter(({ msg }) => {
						if (params.role === "tool") {
							return msg.role === "toolResult" || msg.role === "bashExecution";
						}
						return msg.role === params.role;
					});
				}

				if (hasText) {
					const q = params.searchText!.trim().toLowerCase();
					hits = hits.filter(
						({ msg }) =>
							msg.content.toLowerCase().includes(q) ||
							(msg.thinking?.toLowerCase().includes(q) ?? false) ||
							(msg.command?.toLowerCase().includes(q) ?? false) ||
							(msg.toolName?.toLowerCase().includes(q) ?? false),
					);
				}

				// Most recent first
				hits.reverse();
				const total = hits.length;
				const limit = params.limit ?? 20;
				hits = hits.slice(0, limit);

				if (hits.length === 0) {
					return {
						content: [{ type: "text", text: "No folded messages match." }],
						details: { total: 0 },
					};
				}

				const PREVIEW_CHARS = 200;
				let out = `${total} match${total === 1 ? "" : "es"}${total > hits.length ? ` (showing ${hits.length} most recent)` : ""} — pass an id to get_folded_message for the full message.\n`;
				for (const { id, msg } of hits) {
					const time = new Date(msg.timestamp).toISOString();
					const role = msg.role === "toolResult" || msg.role === "bashExecution" ? "tool" : msg.role;
					let snippet = msg.content || (msg.command ? `$ ${msg.command}` : "(no text)");
					snippet = snippet.replace(/\s+/g, " ").trim();
					if (snippet.length > PREVIEW_CHARS) snippet = snippet.slice(0, PREVIEW_CHARS) + "…";
					out += `\n[${id}] ${role.toUpperCase()} ${time}\n  ${snippet}\n`;
				}

				return {
					content: [{ type: "text", text: out }],
					details: { total, returned: hits.length },
				};
			},
		},
	);

	// --- get_folded_message tool (one FULL message by id) ---

	pi.registerTool(
		{
			name: "get_folded_message",
			label: "Get One Folded Message",
			description: [
				"Retrieve ONE full folded message (including tool calls and outputs) by id.",
				"",
				"Ids come from search_folded results, in the form 'foldIndex:messageIndex',",
				"e.g. '1:3' = fold 1, message 3. Use search_folded first to find ids.",
			].join("\n"),
			parameters: Type.Object({
				id: Type.String({
					description: "Message id from search_folded, e.g. '1:3'.",
					pattern: "^[0-9]+:[0-9]+$",
				}),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const [foldIdxStr, msgIdxStr] = params.id.split(":");
				const foldIdx = Number.parseInt(foldIdxStr, 10);
				const msgIdx = Number.parseInt(msgIdxStr, 10);

				const entries = ctx.sessionManager.getBranch();
				let target: FoldEntryData | undefined;
				for (const entry of entries) {
					if (
						entry.type === "custom" &&
						(entry as { customType?: string }).customType ===
							FOLD_ENTRY_TYPE
					) {
						const data = (entry as { data?: FoldEntryData }).data;
						if (data && data.foldNumber === foldIdx) {
							target = data;
							break;
						}
					}
				}

				if (!target || !target.messages[msgIdx]) {
					return {
						content: [{ type: "text", text: `No folded message with id '${params.id}'. Use search_folded to find valid ids.` }],
						details: {},
					};
				}

				const msg = { ...target.messages[msgIdx], foldNumber: foldIdx };
				let text = `Folded message '${params.id}'${target.label ? ` (fold "${target.label}")` : ""}:\n${formatFoldedMessage(msg)}`;

				const truncated = truncateTail(text, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});
				if (truncated.truncated) {
					text = truncated.content + `\n\n[Truncated: ${truncated.outputLines} of ${truncated.totalLines} lines, ${truncated.outputBytes} of ${truncated.totalBytes} bytes]`;
				}

				return {
					content: [{ type: "text", text }],
					details: { id: params.id, foldNumber: foldIdx, messageIndex: msgIdx },
				};
			},
		},
	);

	// --- /fold command ---

	pi.registerCommand("fold", {
		description:
			"Fold conversation history into a sentinel marker (optionally label it)",
		handler: async (args, ctx) => {
			const label = args.trim() || undefined;
			const entries = ctx.sessionManager.getBranch();

			// Find the latest fold-marker so we only fold *new* messages
			let lastMarkerIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i];
				if (
					entry.type === "custom_message" &&
					(entry as { customType?: string }).customType ===
						FOLD_MARKER_TYPE
				) {
					lastMarkerIndex = i;
					break;
				}
			}

			// Collect messages to fold (after last marker, or all if no marker)
			const messagesToFold: AgentMessage[] = [];
			for (let i = lastMarkerIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message") {
					messagesToFold.push(entry.message);
				}
			}

			if (messagesToFold.length === 0) {
				ctx.ui.notify(
					"Nothing new to fold since the last marker.",
					"info",
				);
				return;
			}

			// Update counters
			foldCount++;
			const newMessageCount = messagesToFold.length;
			totalFolded += newMessageCount;

			// Serialize messages for storage
			const foldedMessages = messagesToFold
				.map(serializeMessage)
				.filter((m): m is FoldedMessage => m !== null);

			// Build a truncated prose digest (user/assistant text only) so the
			// LLM retains coarse recollection without needing to call the tool.
			const digestParts: string[] = [];
			let digestBytes = 0;
			const MAX_ENTRY_CHARS = 200;
			const MAX_DIGEST_CHARS = 2000;
			for (let i = messagesToFold.length - 1; i >= 0; i--) {
				const m = messagesToFold[i];
				if (m.role !== "user" && m.role !== "assistant") continue;
				const text = extractText(
					(m as UserMessage | AssistantMessage).content,
				).trim();
				if (!text) continue;
				const truncated =
					text.length > MAX_ENTRY_CHARS
						? text.slice(0, MAX_ENTRY_CHARS) + "…"
						: text;
				const oneLine = truncated.replace(/\s+/g, " ");
				const part = `${m.role === "user" ? "User" : "Assistant"}: ${oneLine}`;
				if (digestBytes + part.length > MAX_DIGEST_CHARS) {
					digestParts.unshift("[older messages omitted]");
					break;
				}
				digestParts.unshift(part);
				digestBytes += part.length;
			}
			const digest =
				digestParts.length > 0
					? `\n\nConversation digest (truncated, for reference only):
${digestParts.map((p) => `- ${p}`).join("\n")}`
					: "";

			// Store as a CustomEntry (persisted, NOT sent to LLM)
			pi.appendEntry(FOLD_ENTRY_TYPE, {
				foldNumber: foldCount,
				messageCount: foldedMessages.length,
				label,
				createdAt: Date.now(),
				messages: foldedMessages,
			} as FoldEntryData);

			// Send the sentinel marker (visible in transcript + LLM context)
			const labelText = label ? ` ("${label}")` : "";
			const markerContent = `NOTE: The previous ${newMessageCount} message${newMessageCount === 1 ? "" : "s"} in this conversation have been FOLDED to save context tokens. They are NOT in your context window right now.

To retrieve them, call the get_folded_message tool. Examples:
- search_folded() — overview of all folds (${foldCount} fold${foldCount === 1 ? "" : "s"}, ${totalFolded} total messages${labelText})
- search_folded(foldIndex=1) — previews of messages in fold 1
- search_folded(searchText="keyword") — search across all folds
- get_folded_message(id="1:3") — read ONE full message by id from search results

Use this tool whenever you need information from before the fold point.${digest}`;

			pi.sendMessage(
				{
					customType: FOLD_MARKER_TYPE,
					content: markerContent,
					display: true,
					details: {
						foldNumber: foldCount,
						totalFolded,
						foldsCount: foldCount,
						label,
						createdAt: Date.now(),
					} as FoldMarkerDetails,
				},
				{ triggerTurn: false },
			);

			ctx.ui.notify(
				`Folded ${newMessageCount} message${newMessageCount === 1 ? "" : "s"} · total: ${totalFolded} · fold #${foldCount}`,
				"info",
			);
		},
	});
}
