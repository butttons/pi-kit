/**
 * Recall task -- searches past sessions via a sub-agent.
 *
 * Reuses the session index building and loading logic from the
 * original session-recall extension, but runs the search in an
 * isolated sub-agent context instead of polluting the main one.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";
import type { SubAgentTool } from "../types.js";

// ---------------------------------------------------------------------------
// TOON encoder (copied from session-recall.ts)
// ---------------------------------------------------------------------------

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
        const fields = Object.keys(value[0] as Record<string, unknown>);
        lines.push(`${key}[${value.length}]{${fields.join(",")}}:`);
        for (const item of value) {
          const row = fields
            .map((f) => toonValue({ value: (item as Record<string, unknown>)[f] }))
            .join(",");
          lines.push(`  ${row}`);
        }
      } else {
        const vals = value.map((v) => toonValue({ value: v })).join(",");
        lines.push(`${key}[${value.length}]: ${vals}`);
      }
    } else {
      lines.push(`${key}: ${toonValue({ value })}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Session types and parsing
// ---------------------------------------------------------------------------

type SessionIndex = {
  file: string;
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

function parseSessionFile({ filePath }: { filePath: string }): SessionIndex | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");

    if (lines.length === 0) return null;

    let date = "";
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

function loadSession({
  cwd,
  sessionFile,
  query,
}: {
  cwd: string;
  sessionFile: string;
  query: string | undefined;
}): string {
  const sessionDir = getSessionDir({ cwd });
  const filePath = join(sessionDir, sessionFile);

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
  }

  if (conversation.length === 0) {
    return "Session has no readable messages.";
  }

  let result = conversation.join("\n---\n\n");

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const RECALL_SYSTEM_PROMPT = `You are a session recall assistant. You search past conversation sessions to find information the user is looking for.

You will receive a session index in TOON format (compact key-value + tabular arrays) alongside the user's query.

Your job:
1. Identify which session(s) are most likely relevant based on the query.
2. Use the recall_session tool to load the conversation from the matching session file.
3. Synthesize a clear, concise answer based on what you find.

If no sessions seem relevant, say so directly. Do not fabricate information.
Always cite which session file(s) you found the information in.`;

export function buildRecallPrompt({
  cwd,
  query,
  isCompact,
}: {
  cwd: string;
  query: string;
  isCompact: boolean;
}): { userPrompt: string; tools: SubAgentTool[] } {
  const sessions = buildIndex({ cwd });

  const flatSessions = sessions.map((s) => {
    if (isCompact) {
      return {
        file: s.file,
        date: s.date,
        name: s.name ?? "",
        firstMessage: s.firstMessage,
        messageCount: s.messageCount,
        durationMinutes: s.durationMinutes,
        totalCost: s.totalCost,
        models: s.models.join("|"),
      };
    }
    return {
      file: s.file,
      date: s.date,
      name: s.name ?? "",
      firstMessage: s.firstMessage,
      messageCount: s.messageCount,
      durationMinutes: s.durationMinutes,
      totalCost: s.totalCost,
      models: s.models.join("|"),
      filesTouched: s.filesTouched.join("|"),
      compactionSummaries: s.compactionSummaries.join("|"),
    };
  });

  const payload = { query, sessions: flatSessions };

  const userPrompt = [
    "Search my past sessions for the query below. The session index is in TOON format.",
    "",
    "```toon",
    encodeToon({ data: payload }),
    "```",
  ].join("\n");

  const recallTool: SubAgentTool = {
    name: "recall_session",
    description:
      "Load a past session's conversation by filename. Use after reviewing the session index to retrieve the full conversation.",
    parameters: {
      type: "object",
      properties: {
        sessionFile: {
          type: "string",
          description: "The session .jsonl filename from the index",
        },
        query: {
          type: "string",
          description: "Optional focus query to filter relevant messages within the session",
        },
      },
      required: ["sessionFile"],
    },
    execute: async (params) => {
      return loadSession({
        cwd,
        sessionFile: params.sessionFile as string,
        query: params.query as string | undefined,
      });
    },
  };

  return { userPrompt, tools: [recallTool] };
}

export { RECALL_SYSTEM_PROMPT };
