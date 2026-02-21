/**
 * Auto Commit Nudge Extension
 *
 * Tracks write/edit tool calls and nudges the agent to commit
 * after a threshold of file changes without a git commit.
 * Resets when a git commit is detected in a bash call or when
 * the user sends a new message.
 *
 * Off by default. Toggle with /commit-nudge.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const WRITE_TOOLS = new Set(["write", "edit"]);
const THRESHOLD = 4;

export default function autoCommitNudge(pi: ExtensionAPI): void {
  let isEnabled = false;
  let writesSinceLastCommit = 0;
  let hasNudged = false;

  pi.registerCommand("commit-nudge", {
    description: "Toggle auto commit nudge (currently off by default)",
    handler: async (_args, ctx) => {
      isEnabled = !isEnabled;
      writesSinceLastCommit = 0;
      hasNudged = false;
      const state = isEnabled ? "enabled" : "disabled";
      ctx.ui.notify(`Auto commit nudge ${state}`);
      ctx.ui.setStatus(
        "commit-nudge",
        isEnabled ? ctx.ui.theme.fg("warning", "commit-nudge") : undefined,
      );
    },
  });

  pi.on("before_agent_start", async () => {
    hasNudged = false;
  });

  pi.on("tool_result", async (event) => {
    if (!isEnabled) return;
    if (!WRITE_TOOLS.has(event.toolName)) return;
    if (event.isError) return;
    writesSinceLastCommit++;
  });

  pi.on("tool_call", async (event) => {
    if (!isEnabled) return;

    // Reset counter when a git commit happens
    if (event.toolName === "bash") {
      const command = (event.input as { command?: string }).command ?? "";
      if (/\bgit\s+commit\b/.test(command)) {
        writesSinceLastCommit = 0;
        hasNudged = false;
        return;
      }
    }

    // Nudge before the next write/edit after threshold
    if (WRITE_TOOLS.has(event.toolName) && writesSinceLastCommit >= THRESHOLD && !hasNudged) {
      hasNudged = true;

      return {
        block: true,
        reason: [
          `You have made ${writesSinceLastCommit} file changes without committing.`,
          "Commit the current changes before continuing with more edits.",
        ].join("\n"),
      };
    }
  });
}
