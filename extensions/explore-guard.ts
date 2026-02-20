/**
 * Explore Guard Extension
 *
 * Passive guardrail that prevents the agent from over-exploring
 * without user guidance. Tracks consecutive tool calls (read, bash,
 * grep, find, ls) and after a threshold, injects a check-in message
 * forcing the agent to pause, summarize findings, and ask before
 * continuing.
 *
 * Always on by default. Use /explore to disable for the current turn.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const EXPLORE_TOOLS = new Set(["read", "bash", "grep", "find", "ls"]);
const THRESHOLD = 4;

export default function exploreGuard(pi: ExtensionAPI): void {
  let consecutiveExploreCount = 0;
  let hasInjectedCheckIn = false;
  let isDisabledForTurn = false;

  pi.registerCommand("explore", {
    description: "Disable explore guard for the current turn",
    handler: async (_args, ctx) => {
      isDisabledForTurn = true;
      ctx.ui.notify("Explore guard disabled for the next prompt.", "info");
    },
  });

  // Reset counter when user sends a message
  pi.on("before_agent_start", async () => {
    consecutiveExploreCount = 0;
    hasInjectedCheckIn = false;
  });

  // Re-enable guard after agent finishes
  pi.on("agent_end", async () => {
    isDisabledForTurn = false;
  });

  // Count consecutive explore tool calls
  pi.on("tool_result", async () => {
    consecutiveExploreCount++;
  });

  // Check threshold before each explore tool call
  pi.on("tool_call", async (event) => {
    if (isDisabledForTurn) return;

    if (!EXPLORE_TOOLS.has(event.toolName)) {
      // Write/edit calls are intentional actions, not exploration.
      // Reset the counter since the agent is doing real work.
      consecutiveExploreCount = 0;
      hasInjectedCheckIn = false;
      return;
    }

    if (consecutiveExploreCount >= THRESHOLD && !hasInjectedCheckIn) {
      hasInjectedCheckIn = true;
      consecutiveExploreCount = 0;

      return {
        block: true,
        reason: [
          `You have made ${THRESHOLD} consecutive read/explore calls without user input.`,
          "Pause here. Summarize what you have found so far and what you plan to do next.",
          "Ask the user before continuing to explore or implement.",
        ].join("\n"),
      };
    }
  });
}
