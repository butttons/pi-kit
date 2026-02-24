/**
 * Explore task -- explores a codebase directory via a sub-agent.
 *
 * Gives the sub-agent read-only tools (read files, list directories,
 * run grep/find) scoped to a target path. The sub-agent investigates
 * based on a user query and returns findings.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";
import type { SubAgentTool } from "../types.js";

function resolveSafe({ targetPath, basePath }: { targetPath: string; basePath: string }): string | null {
  const resolved = isAbsolute(targetPath) ? resolve(targetPath) : resolve(basePath, targetPath);
  if (!resolved.startsWith(basePath)) return null;
  return resolved;
}

function truncateOutput({ text }: { text: string }): string {
  const truncation = truncateHead(text, {
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

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration assistant. You investigate a directory to answer the user's question.

You have read-only tools: read files, list directories, grep for patterns, and find files.
All paths are relative to the target directory.

Your job:
1. Understand the user's question.
2. Explore the codebase methodically -- start with high-level structure, then drill into specifics.
3. Return a clear, thorough answer based on what you find in the source code.

Be factual. Only report what you observe in the code. Do not speculate beyond what the source shows.
When referencing files, use paths relative to the target directory.`;

export function buildExplorePrompt({
  targetPath,
  query,
}: {
  targetPath: string;
  query: string;
}): { systemPrompt: string; userPrompt: string; tools: SubAgentTool[] } {
  const basePath = resolve(targetPath);

  const userPrompt = [
    `Explore the codebase at: ${basePath}`,
    "",
    `Question: ${query}`,
  ].join("\n");

  const readFileTool: SubAgentTool = {
    name: "read_file",
    description:
      "Read the contents of a file. Path is relative to the target directory. Supports an optional line offset and limit.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the target directory",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read. Optional.",
        },
      },
      required: ["path"],
    },
    execute: async (params) => {
      const filePath = resolveSafe({ targetPath: params.path as string, basePath });
      if (!filePath) return "Error: path escapes target directory.";

      try {
        const stat = statSync(filePath);
        if (!stat.isFile()) return "Error: not a file.";

        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        const offset = typeof params.offset === "number" ? Math.max(1, params.offset) : 1;
        const limit = typeof params.limit === "number" ? params.limit : lines.length;
        const sliced = lines.slice(offset - 1, offset - 1 + limit).join("\n");

        const header = `${relative(basePath, filePath)} (${lines.length} lines)`;
        return truncateOutput({ text: `${header}\n${sliced}` });
      } catch {
        return `Error: cannot read file: ${params.path}`;
      }
    },
  };

  const listDirTool: SubAgentTool = {
    name: "list_dir",
    description:
      "List files and directories at a path. Path is relative to the target directory. Returns names with / suffix for directories.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to the target directory. Use '.' for root.",
        },
      },
      required: ["path"],
    },
    execute: async (params) => {
      const dirPath = resolveSafe({ targetPath: params.path as string, basePath });
      if (!dirPath) return "Error: path escapes target directory.";

      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        const formatted = entries
          .filter((e) => e.name !== "node_modules" && e.name !== ".git")
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort();

        if (formatted.length === 0) return "Empty directory.";
        return formatted.join("\n");
      } catch {
        return `Error: cannot list directory: ${params.path}`;
      }
    },
  };

  const grepTool: SubAgentTool = {
    name: "grep",
    description:
      "Search for a pattern in files using grep. Returns matching lines with file paths and line numbers. Excludes node_modules and .git.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Search pattern (basic regex)",
        },
        path: {
          type: "string",
          description: "Directory or file to search in, relative to target directory. Use '.' for all files.",
        },
        flags: {
          type: "string",
          description: "Optional grep flags like -i for case-insensitive. Defaults to empty.",
        },
      },
      required: ["pattern"],
    },
    execute: async (params) => {
      const searchPath = resolveSafe({
        targetPath: (params.path as string) ?? ".",
        basePath,
      });
      if (!searchPath) return "Error: path escapes target directory.";

      try {
        const flags = typeof params.flags === "string" ? params.flags : "";
        const cmd = `grep -rn ${flags} --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.json' --include='*.md' --include='*.toml' --include='*.yaml' --include='*.yml' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next -- ${JSON.stringify(params.pattern as string)} ${JSON.stringify(searchPath)} 2>/dev/null || true`;

        const output = execSync(cmd, {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: 15000,
        });

        if (!output.trim()) return "No matches found.";

        // Make paths relative to basePath
        const relativeOutput = output
          .split("\n")
          .map((line) => {
            if (line.startsWith(basePath)) {
              return line.slice(basePath.length + 1);
            }
            return line;
          })
          .join("\n");

        return truncateOutput({ text: relativeOutput });
      } catch {
        return "Error: grep failed.";
      }
    },
  };

  const findTool: SubAgentTool = {
    name: "find_files",
    description:
      "Find files by name pattern. Returns paths relative to the target directory. Excludes node_modules and .git.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "File name pattern (glob-style, e.g. '*.test.ts', 'schema*')",
        },
        path: {
          type: "string",
          description: "Directory to search in, relative to target directory. Use '.' for all.",
        },
      },
      required: ["pattern"],
    },
    execute: async (params) => {
      const searchPath = resolveSafe({
        targetPath: (params.path as string) ?? ".",
        basePath,
      });
      if (!searchPath) return "Error: path escapes target directory.";

      try {
        const cmd = `find ${JSON.stringify(searchPath)} -name ${JSON.stringify(params.pattern as string)} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' 2>/dev/null | sort || true`;

        const output = execSync(cmd, {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: 15000,
        });

        if (!output.trim()) return "No files found.";

        const relativeOutput = output
          .trim()
          .split("\n")
          .map((line) => {
            if (line.startsWith(basePath)) {
              return line.slice(basePath.length + 1);
            }
            return line;
          })
          .join("\n");

        return truncateOutput({ text: relativeOutput });
      } catch {
        return "Error: find failed.";
      }
    },
  };

  return {
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    userPrompt,
    tools: [readFileTool, listDirTool, grepTool, findTool],
  };
}

export { EXPLORE_SYSTEM_PROMPT };
