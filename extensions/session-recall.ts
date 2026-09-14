/**
 * Session Recall Extension
 *
 * Search past sessions by query, list them with pagination/filtering, and
 * load full conversations. Works within the current project or across all
 * projects on this machine.
 *
 * Commands:
 *   /recall how did we fix the file tracker crash
 *   /recall --all what was the tmux extension approach
 *   /recall --compact <query>   (slimmer index, project only)
 *
 * Tools:
 *   list_sessions    - Paginated, filterable session index (project or all)
 *   search_sessions  - Full-text search across session conversations
 *   recall_session   - Load a past session's conversation by filename/cwd
 *
 * /recall builds a lightweight index of all sessions (date, cwd, first
 * message, cost, duration, models, files touched, compaction summaries) and
 * sends it in TOON format alongside your query. The LLM picks the relevant
 * session and can call `recall_session` to retrieve its conversation.
 * `--all` scans every project; without it, only the current project.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  SessionManager,
  type SessionInfo,
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/**
 * Minimal TOON encoder for session index data.
 *
 * Handles: primitives, arrays of primitives, and uniform arrays of
 * flat objects (rendered as tabular rows). Covers everything the
 * session index needs without pulling in a dependency.
 *
 * Format reference: https://github.com/toon-format/spec
 */
function toonValue({ value }: { value: unknown }): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const str = String(value);
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function encodeToon({ data }: { data: Record<string, unknown> }): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}[0]:`);
      } else if (typeof value[0] === "object" && value[0] !== null) {
        // Uniform array of objects -- tabular format
        const fields = Object.keys(value[0] as Record<string, unknown>);
        lines.push(`${key}[${value.length}]{${fields.join(",")}}:`);
        for (const item of value) {
          const row = fields
            .map((f) => toonValue({ value: (item as Record<string, unknown>)[f] }))
            .join(",");
          lines.push(`  ${row}`);
        }
      } else {
        // Array of primitives
        const vals = value.map((v) => toonValue({ value: v })).join(",");
        lines.push(`${key}[${value.length}]: ${vals}`);
      }
    } else {
      lines.push(`${key}: ${toonValue({ value })}`);
    }
  }

  return lines.join("\n");
}

type SessionIndex = {
  file: string;
  cwd: string;
  date: string;
  name: string | undefined;
  firstMessage: string;
  messageCount: number;
  durationMinutes: number;
  totalCost: number;
  models: string[];
  filesTouched: string[];
  compactionSummaries: string[];
};

function parseArgs({ raw }: { raw: string }): {
  query: string;
  isCompact: boolean;
  isAll: boolean;
} {
  const isCompact = /--compact\b/.test(raw);
  const isAll = /--all\b/.test(raw);
  const query = raw.replace(/--compact\b/, "").replace(/--all\b/, "").trim();
  return { query, isCompact, isAll };
}

function getSessionDir({ cwd }: { cwd: string }): string {
  const stripped = cwd.startsWith("/") ? cwd.slice(1) : cwd;
  const encoded = stripped.replace(/\//g, "-");
  return join(
    process.env.HOME ?? "~",
    ".pi",
    "agent",
    "sessions",
    `--${encoded}--`,
  );
}

function parseSessionFile({ filePath }: { filePath: string }): SessionIndex | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");

    if (lines.length === 0) return null;

    let date = "";
    let cwd = "";
    let name: string | undefined;
    let firstMessage = "";
    let messageCount = 0;
    let totalCost = 0;
    let firstTimestamp = 0;
    let lastTimestamp = 0;
    const modelsSet = new Set<string>();
    const filesSet = new Set<string>();
    const compactionSummaries: string[] = [];

    for (const line of lines) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsing raw JSONL with unknown shapes
      let entry: Record<string, any>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === "session") {
        date = entry.timestamp ?? "";
        cwd = entry.cwd ?? "";
        continue;
      }

      if (entry.type === "session_info" && entry.name) {
        name = entry.name;
        continue;
      }

      if (entry.type === "model_change" && entry.modelId) {
        modelsSet.add(entry.modelId);
        continue;
      }

      if (entry.type === "compaction" && entry.summary) {
        compactionSummaries.push(entry.summary.slice(0, 500));
        continue;
      }

      if (entry.type !== "message") continue;

      const msg = entry.message;
      if (!msg) continue;

      // Track timestamps for duration
      const ts = msg.timestamp;
      if (typeof ts === "number" && ts > 0) {
        if (firstTimestamp === 0) firstTimestamp = ts;
        lastTimestamp = ts;
      }

      if (msg.role === "user") {
        messageCount++;
        if (!firstMessage) {
          const msgContent = msg.content;
          if (typeof msgContent === "string") {
            firstMessage = msgContent.slice(0, 200);
          } else if (Array.isArray(msgContent)) {
            const textBlock = msgContent.find(
              (b: Record<string, string>) => b.type === "text",
            );
            if (textBlock) {
              firstMessage = textBlock.text.slice(0, 200);
            }
          }
        }
        continue;
      }

      if (msg.role === "assistant") {
        messageCount++;
        if (msg.usage?.cost?.total) {
          totalCost += msg.usage.cost.total;
        }
        if (msg.model) {
          modelsSet.add(msg.model);
        }
        // Extract file paths from write/edit tool calls
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (
              block.type === "toolCall" &&
              (block.name === "write" || block.name === "edit") &&
              block.arguments?.path
            ) {
              filesSet.add(block.arguments.path);
            }
          }
        }
        continue;
      }
    }

    if (!firstMessage && !name) return null;

    const durationMinutes =
      firstTimestamp > 0 && lastTimestamp > firstTimestamp
        ? Math.round((lastTimestamp - firstTimestamp) / 60_000)
        : 0;

    return {
      file: basename(filePath),
      cwd,
      date: date.slice(0, 10),
      name,
      firstMessage,
      messageCount,
      durationMinutes,
      totalCost: Math.round(totalCost * 1000) / 1000,
      models: [...modelsSet],
      filesTouched: [...filesSet],
      compactionSummaries,
    };
  } catch {
    return null;
  }
}

function buildIndex({ cwd }: { cwd: string }): SessionIndex[] {
  const sessionDir = getSessionDir({ cwd });

  let files: string[];
  try {
    files = readdirSync(sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  const index: SessionIndex[] = [];
  for (const file of files) {
    const filePath = join(sessionDir, file);
    const entry = parseSessionFile({ filePath });
    if (entry) {
      index.push(entry);
    }
  }

  return index;
}

/** Map a canonical SessionInfo (from SessionManager) into the rich index shape. */
function sessionInfoToIndex(info: SessionInfo): SessionIndex {
  return {
    file: basename(info.path),
    cwd: info.cwd,
    date: info.modified.toISOString().slice(0, 10),
    name: info.name,
    firstMessage: info.firstMessage,
    messageCount: info.messageCount,
    durationMinutes: 0,
    totalCost: 0,
    models: [],
    filesTouched: [],
    compactionSummaries: [],
  };
}

function loadSession({
  cwd,
  sessionFile,
  query,
}: {
  cwd: string;
  sessionFile: string;
  query: string | undefined;
}): string {
  const filePath = resolveSessionPath({ cwd, sessionFile });

  try {
    statSync(filePath);
  } catch {
    return `Session file not found: ${sessionFile}`;
  }

  const content = readFileSync(filePath, "utf8");
  const lines = content.trim().split("\n");
  const conversation: string[] = [];
  const queryLower = query?.toLowerCase();

  for (const line of lines) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsing raw JSONL with unknown shapes
    let entry: Record<string, any>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "compaction" && entry.summary) {
      conversation.push(`[COMPACTION SUMMARY]\n${entry.summary}\n`);
      continue;
    }

    if (entry.type !== "message") continue;

    const msg = entry.message;
    if (!msg) continue;

    if (msg.role === "user") {
      const text = extractMessageText({ message: msg });
      if (text) {
        conversation.push(`[USER]\n${text}\n`);
      }
    } else if (msg.role === "assistant") {
      const text = extractMessageText({ message: msg });
      if (text) {
        conversation.push(`[ASSISTANT]\n${text}\n`);
      }
    }
    // Skip toolResult entries -- too noisy
  }

  if (conversation.length === 0) {
    return "Session has no readable messages.";
  }

  let result = conversation.join("\n---\n\n");

  // If query provided, try to extract relevant chunks
  if (queryLower) {
    const relevant = conversation.filter((chunk) =>
      chunk.toLowerCase().includes(queryLower),
    );
    if (relevant.length > 0 && relevant.length < conversation.length) {
      result =
        `[Filtered to ${relevant.length} of ${conversation.length} messages matching "${query}"]\n\n` +
        relevant.join("\n---\n\n");
    }
  }

  const truncation = truncateHead(result, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (truncation.truncated) {
    return (
      truncation.content +
      `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines]`
    );
  }

  return truncation.content;
}

/**
 * Resolve a session file reference to an absolute path.
 * Accepts an absolute path, or a filename resolved against the session
 * directory of a given project cwd.
 */
function resolveSessionPath({
  cwd,
  sessionFile,
}: {
  cwd: string;
  sessionFile: string;
}): string {
  const isAbsolute =
    sessionFile.startsWith("/") || /^[A-Za-z]:[\\/]/.test(sessionFile);
  if (isAbsolute) {
    return sessionFile;
  }
  return join(getSessionDir({ cwd }), sessionFile);
}

function extractMessageText({
  message,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw JSONL message with unknown content shape
  message: Record<string, any>;
}): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((b: Record<string, string>) => b.type === "text")
    .map((b: Record<string, string>) => b.text)
    .join("\n");
}

// --- list_sessions helpers ---

type ListFilters = {
  query?: string;
  cwd?: string;
  maxAgeDays?: number;
};

function matchesFilters(session: SessionInfo, filters: ListFilters): boolean {
  if (filters.query) {
    const q = filters.query.toLowerCase();
    const haystack = `${session.name ?? ""} ${session.firstMessage ?? ""}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.cwd) {
    if (!session.cwd.toLowerCase().includes(filters.cwd.toLowerCase())) {
      return false;
    }
  }
  if (filters.maxAgeDays && filters.maxAgeDays > 0) {
    const cutoff = Date.now() - filters.maxAgeDays * 86_400_000;
    if (session.modified.getTime() < cutoff) return false;
  }
  return true;
}

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(11, 16);
}

// --- search_sessions helpers ---

/**
 * Extract up to `max` snippets of text around occurrences of `term`.
 * `text` is the original casing; `lowerText` its lowercase twin for matching.
 */
function extractSnippets({
  text,
  lowerText,
  term,
  contextChars,
  max,
}: {
  text: string;
  lowerText: string;
  term: string;
  contextChars: number;
  max: number;
}): string[] {
  const snippets: string[] = [];
  let from = 0;
  while (snippets.length < max) {
    const idx = lowerText.indexOf(term, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - Math.floor(contextChars / 2));
    const end = Math.min(
      text.length,
      idx + term.length + Math.ceil(contextChars / 2),
    );
    const snippet =
      (start > 0 ? "…" : "") +
      text.slice(start, end).replace(/\s+/g, " ").trim() +
      (end < text.length ? "…" : "");
    snippets.push(snippet);
    from = end;
  }
  return snippets;
}

async function collectSessions({
  cwd,
  scope,
}: {
  cwd: string;
  scope: "project" | "all";
}): Promise<SessionInfo[]> {
  return scope === "all" ? SessionManager.listAll() : SessionManager.list(cwd);
}

function payloadToText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export default function sessionRecall(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_sessions",
    label: "List Sessions",
    description:
      "List past sessions with pagination and filtering. Defaults to the current project; use scope=all to include every project on this machine. Returns an index (file, project cwd, date, name, message count, first message). Use with recall_session to load a full conversation.",
    parameters: Type.Object({
      scope: Type.Optional(
        Type.Union([Type.Literal("project"), Type.Literal("all")], {
          description:
            '"project" = sessions of the current working directory (default), "all" = sessions from every project',
        }),
      ),
      query: Type.Optional(
        Type.String({
          description:
            "Optional substring filter, matched against session name and first message",
        }),
      ),
      cwd: Type.Optional(
        Type.String({
          description:
            "Optional substring filter on the session's project path (e.g. 'pi-kit' or '/Users/yash/Work')",
        }),
      ),
      maxAgeDays: Type.Optional(
        Type.Number({
          description: "Only include sessions modified within the last N days",
        }),
      ),
      page: Type.Optional(
        Type.Number({ description: "Page number, 1-based (default: 1)" }),
      ),
      pageSize: Type.Optional(
        Type.Number({
          description: "Results per page, max 100 (default: 20)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = params.scope ?? "project";
      const page = Math.max(1, Math.floor(params.page ?? 1));
      const pageSize = Math.min(
        100,
        Math.max(1, Math.floor(params.pageSize ?? 20)),
      );
      const filters: ListFilters = {
        query: params.query?.trim() || undefined,
        cwd: params.cwd?.trim() || undefined,
        maxAgeDays: params.maxAgeDays,
      };

      const sessions = await collectSessions({ cwd: ctx.cwd, scope });
      const filtered = sessions.filter((s) => matchesFilters(s, filters));
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

      const result = {
        scope,
        page,
        pageSize,
        total,
        totalPages,
        note:
          "Use recall_session with the session file and cwd to load a full conversation.",
        sessions: slice.map((s) => ({
          file: basename(s.path),
          cwd: s.cwd,
          date: formatDate(s.modified),
          time: formatTime(s.modified),
          name: s.name ?? "",
          messageCount: s.messageCount,
          firstMessage: s.firstMessage.slice(0, 300),
        })),
      };

      return {
        content: [{ type: "text", text: payloadToText(result) }],
        details: {
          scope,
          page,
          pageSize,
          total,
          sessions: slice.length,
        },
      };
    },
  });

  pi.registerTool({
    name: "search_sessions",
    label: "Search Sessions",
    description:
      "Full-text search across past session conversations. All space-separated terms must appear in a session (case-insensitive). Defaults to the current project; use scope=all to search every project on this machine. Returns matching sessions with text snippets and the info needed to load the full conversation via recall_session.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search terms; all terms must appear in a session's conversation (e.g. 'tmux extension approach')",
      }),
      scope: Type.Optional(
        Type.Union([Type.Literal("project"), Type.Literal("all")], {
          description:
            '"project" = current working directory only (default), "all" = every project',
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Max sessions to return, most relevant first (default: 10, max: 50)",
        }),
      ),
      contextChars: Type.Optional(
        Type.Number({
          description: "Characters of surrounding context per snippet (default: 200)",
        }),
      ),
      maxSnippetsPerSession: Type.Optional(
        Type.Number({
          description: "Max context snippets per session (default: 3, max: 10)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const terms = params.query.trim().toLowerCase().split(/\s+/).filter(Boolean);

      if (terms.length === 0) {
        return {
          content: [
            { type: "text", text: "Query must contain at least one search term." },
          ],
          details: { error: "empty query" },
        };
      }

      const scope = params.scope ?? "project";
      const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 10)));
      const contextChars = Math.min(
        1000,
        Math.max(50, Math.floor(params.contextChars ?? 200)),
      );
      const maxSnippets = Math.min(
        10,
        Math.max(1, Math.floor(params.maxSnippetsPerSession ?? 3)),
      );

      const sessions = await collectSessions({ cwd: ctx.cwd, scope });
      const matches: Array<{
        file: string;
        cwd: string;
        date: string;
        time: string;
        name: string;
        messageCount: number;
        matchCount: number;
        snippets: string[];
      }> = [];

      for (const session of sessions) {
        const text = session.allMessagesText ?? "";
        if (!text) continue;
        const lowerText = text.toLowerCase();
        if (!terms.every((term) => lowerText.includes(term))) continue;

        const snippets = extractSnippets({
          text,
          lowerText,
          term: terms[0],
          contextChars,
          max: maxSnippets,
        });

        matches.push({
          file: basename(session.path),
          cwd: session.cwd,
          date: formatDate(session.modified),
          time: formatTime(session.modified),
          name: session.name ?? "",
          messageCount: session.messageCount,
          matchCount: snippets.length,
          snippets,
        });
      }

      // Most relevant first: most snippets, then most recent
      matches.sort(
        (a, b) =>
          b.matchCount - a.matchCount ||
          b.date.localeCompare(a.date) ||
          b.time.localeCompare(a.time),
      );
      const top = matches.slice(0, limit);

      const result = {
        query: params.query.trim(),
        scope,
        total: matches.length,
        note:
          'Use recall_session with {sessionFile, cwd} to load the full conversation of a match.',
        matches: top,
      };

      return {
        content: [{ type: "text", text: payloadToText(result) }],
        details: { query: params.query, scope, total: matches.length, returned: top.length },
      };
    },
  });

  pi.registerTool({
    name: "recall_session",
    label: "Recall Session",
    description:
      "Load a past session's conversation by filename. Use after /recall, list_sessions, or search_sessions. Pass cwd (the project the session belongs to) for sessions outside the current project, or an absolute path as sessionFile.",
    parameters: Type.Object({
      sessionFile: Type.String({
        description:
          "The session .jsonl filename from the index, or an absolute path",
      }),
      cwd: Type.Optional(
        Type.String({
          description:
            "Project working directory the session belongs to. Defaults to the current project.",
        }),
      ),
      query: Type.Optional(
        Type.String({
          description:
            "Optional focus query to filter relevant messages within the session",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = loadSession({
        cwd: params.cwd ?? ctx.cwd,
        sessionFile: params.sessionFile,
        query: params.query,
      });

      return {
        content: [{ type: "text", text: result }],
        details: { sessionFile: params.sessionFile, cwd: params.cwd, query: params.query },
      };
    },
  });

  pi.registerCommand("recall", {
    description: "Search past sessions: /recall [--compact] [--all] <query>",
    handler: async (args, ctx) => {
      const { query, isCompact, isAll } = parseArgs({ raw: args });

      if (!query) {
        ctx.ui.notify("Usage: /recall [--compact] [--all] <query>", "error");
        return;
      }

      const sessions = isAll
        ? (await SessionManager.listAll()).map(sessionInfoToIndex)
        : buildIndex({ cwd: ctx.cwd });

      // Flatten nested arrays into pipe-delimited strings for tabular encoding
      const flatSessions = sessions.map((s) => {
        const base = {
          file: s.file,
          cwd: s.cwd,
          date: s.date,
          name: s.name ?? "",
          firstMessage: s.firstMessage,
          messageCount: s.messageCount,
        };
        if (isCompact || isAll) {
          return base;
        }
        return {
          ...base,
          durationMinutes: s.durationMinutes,
          totalCost: s.totalCost,
          models: s.models.join("|"),
          filesTouched: s.filesTouched.join("|"),
          compactionSummaries: s.compactionSummaries.join("|"),
        };
      });

      const payload = {
        query,
        scope: isAll ? "all projects" : "current project",
        sessions: flatSessions,
      };

      const prompt = [
        "Search my past sessions for the query below. The session index is in TOON format (compact key-value + tabular arrays).",
        isAll
          ? "The index spans ALL projects on this machine; each row includes the project cwd."
          : "The index covers the current project only.",
        "Identify which session(s) are most likely relevant.",
        'Use the recall_session tool to load the conversation from the matching session file. For sessions from other projects (--all), pass the session\'s cwd.',
        "Then answer the query based on what you find.",
        "",
        "```toon",
        encodeToon({ data: payload }),
        "```",
      ].join("\n");

      pi.sendUserMessage(prompt);
    },
  });
}