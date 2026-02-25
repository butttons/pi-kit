/**
 * Lazy AGENTS.md Extension
 *
 * Loads AGENTS.md files on demand as the agent touches directories.
 * Pi only loads AGENTS.md files walking up from cwd at startup.
 * This extension watches tool calls (read, write, edit, grep, find,
 * ls) and when the agent accesses a directory containing an AGENTS.md
 * that hasn't been loaded yet, injects its contents into the LLM
 * context on every subsequent turn.
 *
 * Only looks within the project root (cwd). Walks up from the
 * accessed path to cwd, loading any AGENTS.md files found along
 * the way that haven't been injected yet.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const AGENTS_FILENAMES = ["AGENTS.md", "CLAUDE.md"];

function findAgentsFile({ dir }: { dir: string }): string | null {
  for (const name of AGENTS_FILENAMES) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function collectAgentsPaths({
  targetDir,
  projectRoot,
}: {
  targetDir: string;
  projectRoot: string;
}): string[] {
  const paths: string[] = [];
  let current = targetDir;
  const normalizedRoot = path.resolve(projectRoot);

  while (current.startsWith(normalizedRoot)) {
    // Skip the project root -- pi already loads that one at startup
    if (current === normalizedRoot) break;

    const agentsPath = findAgentsFile({ dir: current });
    if (agentsPath) {
      paths.push(agentsPath);
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return paths;
}

function extractPathFromToolInput({
  event,
}: {
  event: { toolName: string; input: Record<string, unknown> };
}): string | null {
  const name = event.toolName;

  if (name === "read" || name === "write" || name === "edit") {
    const rawPath = event.input.path;
    if (typeof rawPath === "string") return rawPath;
  }

  if (name === "grep" || name === "find" || name === "ls") {
    const rawPath = event.input.path ?? event.input.directory;
    if (typeof rawPath === "string") return rawPath;
  }

  return null;
}

function collectStartupAgentsPaths({
  projectRoot,
}: {
  projectRoot: string;
}): Set<string> {
  const paths = new Set<string>();

  // Walk up from cwd through parents, same as pi does at startup
  let current = projectRoot;
  while (true) {
    const agentsPath = findAgentsFile({ dir: current });
    if (agentsPath) {
      paths.add(path.relative(projectRoot, agentsPath));
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Also check the global AGENTS.md location
  const globalAgents = path.join(
    process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.HOME ?? "", ".pi", "agent"),
    "AGENTS.md",
  );
  if (fs.existsSync(globalAgents)) {
    paths.add(globalAgents);
  }

  return paths;
}

export default function lazyAgents(pi: ExtensionAPI): void {
  // Tracks relative paths of AGENTS.md files already in context (startup or discovered)
  const knownPaths = new Set<string>();
  // Maps relative path -> file content for lazily discovered AGENTS.md files
  const loadedAgents = new Map<string, string>();
  let projectRoot = "";

  pi.on("session_start", async (_event, ctx) => {
    projectRoot = path.resolve(ctx.cwd);
    loadedAgents.clear();

    // Pre-populate with paths pi already loaded at startup so we never duplicate
    const startupPaths = collectStartupAgentsPaths({ projectRoot });
    knownPaths.clear();
    for (const p of startupPaths) {
      knownPaths.add(p);
    }
  });

  // Detect paths from tool calls and load any new AGENTS.md files
  pi.on("tool_call", async (event, ctx) => {
    const rawPath = extractPathFromToolInput({ event });
    if (!rawPath) return;

    const resolvedPath = path.resolve(projectRoot, rawPath);

    if (!resolvedPath.startsWith(projectRoot)) return;

    let targetDir: string;
    try {
      const stat = fs.statSync(resolvedPath);
      targetDir = stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
    } catch {
      targetDir = path.dirname(resolvedPath);
    }

    const agentsPaths = collectAgentsPaths({ targetDir, projectRoot });

    for (const agentsPath of agentsPaths) {
      const relativePath = path.relative(projectRoot, agentsPath);
      if (knownPaths.has(relativePath)) continue;

      let content: string;
      try {
        content = fs.readFileSync(agentsPath, "utf-8").trim();
      } catch {
        continue;
      }

      if (!content) continue;

      knownPaths.add(relativePath);
      loadedAgents.set(relativePath, content);
      ctx.ui.notify(`Loaded ${relativePath}`, "info");
    }
  });

  // Inject all loaded AGENTS.md content into the system prompt
  pi.on("before_agent_start", async (event) => {
    if (loadedAgents.size === 0) return;

    const sections = Array.from(loadedAgents.entries())
      .map(([relativePath, content]) => `## ${relativePath}\n\n${content}`)
      .join("\n\n---\n\n");

    return {
      systemPrompt: [
        event.systemPrompt,
        "",
        "# Additional Project Context (auto-loaded)",
        "",
        "The following context files were discovered in directories you accessed.",
        "Follow these instructions for any work within their respective directories.",
        "",
        sections,
      ].join("\n"),
    };
  });
}
