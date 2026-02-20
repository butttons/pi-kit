/**
 * Tmux Redirect Extension
 *
 * Blocks long-running processes that the agent tries to run
 * inline via bash (dev servers, watchers, build --watch, etc.)
 * and tells it to use tmux instead.
 *
 * Does not block if the command is already being sent to tmux
 * via send-keys or if it is piped/backgrounded intentionally.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const LONG_RUNNING_PATTERNS: RegExp[] = [
  // Dev servers
  /\b(npm|pnpm|bun|yarn)\s+run\s+dev\b/,
  /\b(npm|pnpm|bun|yarn)\s+run\s+start\b/,
  /\bnpx\s+.*\bdev\b/,
  /\bvite\b(?!\s+build)/,
  /\bnext\s+dev\b/,
  /\bastro\s+dev\b/,
  /\bwrangler\s+dev\b/,
  /\bnode\s+.*server/,

  // Watchers
  /--watch\b/,
  /\bwatch\b/,
  /\bnodemon\b/,

  // Tailing logs
  /\bwrangler\s+tail\b/,
  /\btail\s+-f\b/,
];

// Already going through tmux or explicitly backgrounded
const EXEMPT_PATTERNS: RegExp[] = [
  /\btmux\s+send-keys\b/,
  /\btmux\b/,
  /\btmuxinator\b/,
  /&\s*$/,
  /\bnohup\b/,
];

function isLongRunning({ command }: { command: string }): boolean {
  if (EXEMPT_PATTERNS.some((p) => p.test(command))) return false;
  return LONG_RUNNING_PATTERNS.some((p) => p.test(command));
}

export default function tmuxRedirect(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;

    const command = (event.input as { command?: string }).command ?? "";
    if (!isLongRunning({ command })) return;

    return {
      block: true,
      reason: [
        "This looks like a long-running process. Do not run it inline.",
        "Use tmux send-keys to run it in an appropriate tmux pane instead.",
        "If no tmux session exists, ask the user which pane to use.",
      ].join("\n"),
    };
  });
}
