/**
 * Run Confirm Extension
 *
 * Intercepts expensive or long-running bash commands and asks
 * for user confirmation before executing. Catches build scripts,
 * test suites, generators, and deploy commands that the agent
 * fires off without asking.
 *
 * Different from safe-delete (destructive commands) and
 * tmux-redirect (persistent processes). This is about wasteful
 * one-off commands.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const EXPENSIVE_PATTERNS: RegExp[] = [
  // Build commands
  /\b(npm|pnpm|bun|yarn)\s+run\s+build\b/,
  /\bnpx\s+.*build\b/,
  /\btsc\b(?!.*--noEmit)/,
  /\bvite\s+build\b/,
  /\bnext\s+build\b/,
  /\bastro\s+build\b/,
  /\bwebpack\b/,
  /\bturbo\s+run\s+build\b/,

  // Test suites
  /\b(npm|pnpm|bun|yarn)\s+run\s+test\b/,
  /\b(npm|pnpm|bun|yarn)\s+test\b/,
  /\bvitest\b(?!\s+--help)/,
  /\bjest\b(?!\s+--help)/,
  /\bplaywright\s+test\b/,

  // Generators and heavy scripts
  /\b(npm|pnpm|bun|yarn)\s+run\s+generate\b/,
  /\bbun\s+run\s+\S+\.ts\b/,

  // Deploy
  /\bwrangler\s+deploy\b/,
  /\bwrangler\s+publish\b/,

  // Full installs
  /\b(npm|pnpm|bun|yarn)\s+install\b(?!\s+--help)/,
];

// Commands that are clearly safe/cheap even if they match loosely
const SAFE_PATTERNS: RegExp[] = [
  /--help\b/,
  /--version\b/,
  /--dry-run\b/,
  /\becho\b/,
];

function isExpensiveCommand({ command }: { command: string }): boolean {
  if (SAFE_PATTERNS.some((p) => p.test(command))) return false;
  return EXPENSIVE_PATTERNS.some((p) => p.test(command));
}

export default function runConfirm(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    if (!ctx.hasUI) return;

    const command = (event.input as { command?: string }).command ?? "";
    if (!isExpensiveCommand({ command })) return;

    const isConfirmed = await ctx.ui.confirm(
      "Expensive command",
      `Run this?\n${command}`,
    );

    if (!isConfirmed) {
      return { block: true, reason: "User declined to run this command." };
    }
  });
}
