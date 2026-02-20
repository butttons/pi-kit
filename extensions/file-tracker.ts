/**
 * File Tracker Extension
 *
 * Tracks files touched during a session (read, edited, written) and displays
 * them as a tree widget with +/- line counts. Also provides a /files command
 * for a full-screen view.
 */

import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	DynamicBorder,
	isEditToolResult,
	isToolCallEventType,
	isWriteToolResult,
} from "@mariozechner/pi-coding-agent";
import { Container, Key, matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";

type FileAction = "read" | "edit" | "write";

type FileEntry = {
	path: string;
	actions: Set<FileAction>;
	linesAdded: number;
	linesRemoved: number;
};

type TreeNode = {
	name: string;
	isFile: boolean;
	entry?: FileEntry;
	children: Map<string, TreeNode>;
	linesAdded: number;
	linesRemoved: number;
};

const parseDiffStats = ({
	diff,
}: {
	diff: string;
}): { linesAdded: number; linesRemoved: number } => {
	let linesAdded = 0;
	let linesRemoved = 0;

	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) {
			linesAdded++;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			linesRemoved++;
		}
	}

	return { linesAdded, linesRemoved };
};

const countLines = ({ content }: { content: string }): number => {
	if (content.length === 0) return 0;
	return content.split("\n").length;
};

const buildTree = ({
	files,
	cwd,
}: {
	files: Map<string, FileEntry>;
	cwd: string;
}): TreeNode => {
	const root: TreeNode = {
		name: "",
		isFile: false,
		children: new Map(),
		linesAdded: 0,
		linesRemoved: 0,
	};

	for (const entry of files.values()) {
		const relativePath = entry.path.startsWith(cwd)
			? entry.path.slice(cwd.length + 1)
			: entry.path;
		const parts = relativePath.split(path.sep);

		let current = root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i]!;
			const isLast = i === parts.length - 1;

			if (!current.children.has(part)) {
				current.children.set(part, {
					name: part,
					isFile: isLast,
					entry: isLast ? entry : undefined,
					children: new Map(),
					linesAdded: 0,
					linesRemoved: 0,
				});
			}

			const child = current.children.get(part)!;
			if (isLast) {
				child.isFile = true;
				child.entry = entry;
				child.linesAdded = entry.linesAdded;
				child.linesRemoved = entry.linesRemoved;
			}

			current = child;
		}
	}

	// Propagate counts upward
	const propagate = (node: TreeNode): void => {
		if (node.isFile) return;
		node.linesAdded = 0;
		node.linesRemoved = 0;
		for (const child of node.children.values()) {
			propagate(child);
			node.linesAdded += child.linesAdded;
			node.linesRemoved += child.linesRemoved;
		}
	};
	propagate(root);

	// Collapse single-child directories
	const collapse = (node: TreeNode): void => {
		for (const [key, child] of node.children) {
			if (!child.isFile && child.children.size === 1) {
				const [grandchildKey, grandchild] = [...child.children.entries()][0]!;
				const merged: TreeNode = {
					name: child.name + "/" + grandchild.name,
					isFile: grandchild.isFile,
					entry: grandchild.entry,
					children: grandchild.children,
					linesAdded: child.linesAdded,
					linesRemoved: child.linesRemoved,
				};
				node.children.delete(key);
				node.children.set(merged.name, merged);
				collapse(node); // Re-check in case of further collapsing
				return;
			}
			collapse(child);
		}
	};
	collapse(root);

	return root;
};

const formatStats = ({
	linesAdded,
	linesRemoved,
	theme,
}: {
	linesAdded: number;
	linesRemoved: number;
	theme: { fg: (color: string, text: string) => string };
}): string => {
	const parts: string[] = [];
	if (linesAdded > 0) {
		parts.push(theme.fg("success", `+${linesAdded}`));
	}
	if (linesRemoved > 0) {
		parts.push(theme.fg("error", `-${linesRemoved}`));
	}
	return parts.length > 0 ? parts.join(" ") : "";
};

const formatActionBadge = ({
	actions,
	theme,
}: {
	actions: Set<FileAction>;
	theme: { fg: (color: string, text: string) => string };
}): string => {
	if (actions.has("write") && actions.size === 1) {
		return theme.fg("accent", "[new]");
	}
	if (actions.has("edit")) {
		return theme.fg("warning", "[mod]");
	}
	if (actions.has("read") && actions.size === 1) {
		return theme.fg("dim", "[read]");
	}
	return "";
};

const renderTreeLines = ({
	node,
	prefix,
	isLast,
	isRoot,
	theme,
}: {
	node: TreeNode;
	prefix: string;
	isLast: boolean;
	isRoot: boolean;
	theme: {
		fg: (color: string, text: string) => string;
		bold: (text: string) => string;
	};
}): string[] => {
	const lines: string[] = [];

	if (!isRoot) {
		const connector = isLast ? "└── " : "├── ";
		let line = theme.fg("dim", prefix + connector);

		if (node.isFile && node.entry) {
			const badge = formatActionBadge({ actions: node.entry.actions, theme });
			const stats = formatStats({
				linesAdded: node.linesAdded,
				linesRemoved: node.linesRemoved,
				theme,
			});
			line += theme.fg("text", node.name);
			if (badge) line += " " + badge;
			if (stats) line += " " + stats;
		} else {
			line += theme.fg("accent", node.name + "/");
			const stats = formatStats({
				linesAdded: node.linesAdded,
				linesRemoved: node.linesRemoved,
				theme,
			});
			if (stats) line += " " + stats;
		}

		lines.push(line);
	}

	const sortedChildren = [...node.children.values()].sort((a, b) => {
		// Directories first, then files
		if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
		return a.name.localeCompare(b.name);
	});

	const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");

	for (let i = 0; i < sortedChildren.length; i++) {
		const child = sortedChildren[i]!;
		const isChildLast = i === sortedChildren.length - 1;
		lines.push(
			...renderTreeLines({
				node: child,
				prefix: childPrefix,
				isLast: isChildLast,
				isRoot: false,
				theme,
			}),
		);
	}

	return lines;
};

const WIDGET_MAX_FILES = 5;

export default function fileTracker(pi: ExtensionAPI) {
	let files = new Map<string, FileEntry>();
	let fileOrder: string[] = []; // tracks touch order, most recent last
	let cwd = process.cwd();

	// Pending write paths: track paths from tool_call, resolve in tool_result
	const pendingWrites = new Map<string, string>(); // toolCallId -> path
	const pendingWriteContents = new Map<string, string>(); // toolCallId -> content
	const pendingEditPaths = new Map<string, string>(); // toolCallId -> path

	const touchOrder = ({ filePath }: { filePath: string }): void => {
		const idx = fileOrder.indexOf(filePath);
		if (idx !== -1) {
			fileOrder.splice(idx, 1);
		}
		fileOrder.push(filePath);
	};

	const resolvePath = ({ filePath }: { filePath: string }): string => {
		const cleaned = filePath.startsWith("@") ? filePath.slice(1) : filePath;
		return path.resolve(cwd, cleaned);
	};

	const getOrCreateEntry = ({ filePath }: { filePath: string }): FileEntry => {
		const resolved = resolvePath({ filePath });
		let entry = files.get(resolved);
		if (!entry) {
			entry = {
				path: resolved,
				actions: new Set(),
				linesAdded: 0,
				linesRemoved: 0,
			};
			files.set(resolved, entry);
		}
		touchOrder({ filePath: resolved });
		return entry;
	};

	const updateWidget = ({ ctx }: { ctx: ExtensionContext }): void => {
		if (!ctx.hasUI) return;

		if (files.size === 0) {
			ctx.ui.setWidget("file-tracker", undefined);
			return;
		}

		ctx.ui.setWidget("file-tracker", (_tui, theme) => {
			// Build a subset of only the latest N files for the widget
			const recentPaths = fileOrder.slice(-WIDGET_MAX_FILES);
			const recentFiles = new Map<string, FileEntry>();
			for (const p of recentPaths) {
				const entry = files.get(p);
				if (entry) {
					recentFiles.set(p, entry);
				}
			}

			const tree = buildTree({ files: recentFiles, cwd });
			const totalAdded = tree.linesAdded;
			const totalRemoved = tree.linesRemoved;

			const isTruncated = files.size > WIDGET_MAX_FILES;
			const header =
				theme.fg("dim", "files: ") +
				theme.fg("text", `${files.size}`) +
				(isTruncated
					? theme.fg("dim", ` (latest ${recentFiles.size})`)
					: "") +
				(totalAdded > 0 || totalRemoved > 0
					? " " +
						formatStats({
							linesAdded: totalAdded,
							linesRemoved: totalRemoved,
							theme,
						})
					: "");

			const treeLines = renderTreeLines({
				node: tree,
				prefix: "",
				isLast: true,
				isRoot: true,
				theme,
			});

			const allLines = [header, ...treeLines];

			return {
				render: (width?: number) =>
					width
						? allLines.map((line) => truncateToWidth(line, width))
						: allLines,
				invalidate: () => {},
			};
		});
	};

	const reconstructState = ({ ctx }: { ctx: ExtensionContext }): void => {
		files = new Map();
		fileOrder = [];
		cwd = ctx.cwd;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;

			// Reconstruct from assistant tool calls and their corresponding results
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "toolCall") {
						const toolCall = block as {
							type: "toolCall";
							id: string;
							name: string;
							arguments: Record<string, unknown>;
						};

						if (
							toolCall.name === "read" &&
							typeof toolCall.arguments.path === "string"
						) {
							const fileEntry = getOrCreateEntry({
								filePath: toolCall.arguments.path,
							});
							fileEntry.actions.add("read");
						}

						if (
							toolCall.name === "edit" &&
							typeof toolCall.arguments.path === "string"
						) {
							const fileEntry = getOrCreateEntry({
								filePath: toolCall.arguments.path,
							});
							fileEntry.actions.add("edit");

							// Find the corresponding tool result for diff stats
							const toolResultEntry = ctx.sessionManager
								.getBranch()
								.find(
									(e) =>
										e.type === "message" &&
										e.message.role === "toolResult" &&
										(e.message as { toolCallId?: string }).toolCallId ===
											toolCall.id,
								);

							if (toolResultEntry && toolResultEntry.type === "message") {
								const resultMsg = toolResultEntry.message as {
									details?: { diff?: string };
									isError?: boolean;
								};
								if (resultMsg.details?.diff && !resultMsg.isError) {
									const stats = parseDiffStats({
										diff: resultMsg.details.diff,
									});
									fileEntry.linesAdded += stats.linesAdded;
									fileEntry.linesRemoved += stats.linesRemoved;
								}
							}
						}

						if (
							toolCall.name === "write" &&
							typeof toolCall.arguments.path === "string"
						) {
							const fileEntry = getOrCreateEntry({
								filePath: toolCall.arguments.path,
							});
							fileEntry.actions.add("write");

							// Find the corresponding tool result to check for errors
							const toolResultEntry = ctx.sessionManager
								.getBranch()
								.find(
									(e) =>
										e.type === "message" &&
										e.message.role === "toolResult" &&
										(e.message as { toolCallId?: string }).toolCallId ===
											toolCall.id,
								);

							if (toolResultEntry && toolResultEntry.type === "message") {
								const resultMsg = toolResultEntry.message as {
									isError?: boolean;
								};
								if (
									!resultMsg.isError &&
									typeof toolCall.arguments.content === "string"
								) {
									const lineCount = countLines({
										content: toolCall.arguments.content as string,
									});
									fileEntry.linesAdded += lineCount;
								}
							}
						}
					}
				}
			}
		}
	};

	// -- Events --

	pi.on("session_start", async (_event, ctx) => {
		reconstructState({ ctx });
		updateWidget({ ctx });
	});

	pi.on("session_switch", async (_event, ctx) => {
		reconstructState({ ctx });
		updateWidget({ ctx });
	});

	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("read", event)) {
			const fileEntry = getOrCreateEntry({ filePath: event.input.path });
			fileEntry.actions.add("read");
			updateWidget({ ctx });
		}

		if (isToolCallEventType("edit", event)) {
			pendingEditPaths.set(event.toolCallId, event.input.path);
		}

		if (isToolCallEventType("write", event)) {
			pendingWrites.set(event.toolCallId, event.input.path);
			pendingWriteContents.set(event.toolCallId, event.input.content);
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (isEditToolResult(event) && !event.isError) {
			const filePath = pendingEditPaths.get(event.toolCallId);
			if (filePath) {
				const fileEntry = getOrCreateEntry({ filePath });
				fileEntry.actions.add("edit");

				if (event.details?.diff) {
					const stats = parseDiffStats({ diff: event.details.diff });
					fileEntry.linesAdded += stats.linesAdded;
					fileEntry.linesRemoved += stats.linesRemoved;
				}

				pendingEditPaths.delete(event.toolCallId);
				updateWidget({ ctx });
			}
		}

		if (isWriteToolResult(event) && !event.isError) {
			const filePath = pendingWrites.get(event.toolCallId);
			const content = pendingWriteContents.get(event.toolCallId);
			if (filePath) {
				const fileEntry = getOrCreateEntry({ filePath });
				fileEntry.actions.add("write");

				if (content) {
					const lineCount = countLines({ content });
					fileEntry.linesAdded += lineCount;
				}

				pendingWrites.delete(event.toolCallId);
				pendingWriteContents.delete(event.toolCallId);
				updateWidget({ ctx });
			}
		}
	});

	// -- Command: /files --

	pi.registerCommand("files", {
		description: "Show files touched in this session",
		handler: async (_args, ctx) => {
			if (files.size === 0) {
				ctx.ui.notify("No files touched in this session.", "info");
				return;
			}

			const tree = buildTree({ files, cwd });

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				const container = new Container();

				container.addChild(
					new DynamicBorder((s: string) => theme.fg("accent", s)),
				);

				const totalAdded = tree.linesAdded;
				const totalRemoved = tree.linesRemoved;
				const title =
					theme.fg("accent", theme.bold("Files Touched")) +
					theme.fg("dim", ` (${files.size} files)`) +
					(totalAdded > 0 || totalRemoved > 0
						? " " +
							formatStats({
								linesAdded: totalAdded,
								linesRemoved: totalRemoved,
								theme,
							})
						: "");
				container.addChild(new Text(title, 1, 0));
				container.addChild(new Text("", 0, 0));

				const treeLines = renderTreeLines({
					node: tree,
					prefix: "",
					isLast: true,
					isRoot: true,
					theme,
				});

				for (const line of treeLines) {
					container.addChild(new Text(line, 1, 0));
				}

				container.addChild(new Text("", 0, 0));

				// Legend
				const legend =
					theme.fg("dim", "  ") +
					theme.fg("accent", "[new]") +
					theme.fg("dim", " created  ") +
					theme.fg("warning", "[mod]") +
					theme.fg("dim", " edited  ") +
					theme.fg("dim", "[read]") +
					theme.fg("dim", " read only");
				container.addChild(new Text(legend, 1, 0));

				container.addChild(new Text("", 0, 0));
				container.addChild(
					new Text(theme.fg("dim", "Press esc or q to close"), 1, 0),
				);

				container.addChild(
					new DynamicBorder((s: string) => theme.fg("accent", s)),
				);

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						if (matchesKey(data, Key.escape) || data === "q") {
							done();
						}
					},
				};
			});
		},
	});

	// -- Shortcut: ctrl+f to toggle widget --

	let isWidgetVisible = true;

	pi.registerShortcut("ctrl+shift+f", {
		description: "Toggle file tracker widget",
		handler: async (ctx) => {
			isWidgetVisible = !isWidgetVisible;
			if (isWidgetVisible) {
				updateWidget({ ctx });
			} else {
				ctx.ui.setWidget("file-tracker", undefined);
			}
		},
	});
}
