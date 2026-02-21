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

  const updateStatus = ({
    ctx,
  }: {
    ctx: { ui: { setStatus: (id: string, text: string | undefined) => void } };
  }): void => {
    if (isDisabledForTurn) {
      ctx.ui.setStatus("explore-guard", "explore off");
      return;
    }
    if (consecutiveExploreCount > 0) {
      ctx.ui.setStatus(
        "explore-guard",
        `explore ${consecutiveExploreCount}/${THRESHOLD}`,
      );
      return;
    }
    ctx.ui.setStatus("explore-guard", undefined);
  };

  pi.registerCommand("explore", {
    description: "Disable explore guard for the current turn",
    handler: async (_args, ctx) => {
      isDisabledForTurn = true;
      updateStatus({ ctx });
      ctx.ui.notify("Explore guard disabled for the next prompt.", "info");
    },
  });

  // Reset counter when user sends a message
  pi.on("before_agent_start", async (_event, ctx) => {
    consecutiveExploreCount = 0;
    hasInjectedCheckIn = false;
    updateStatus({ ctx });
  });

  // Re-enable guard after agent finishes
  pi.on("agent_end", async (_event, ctx) => {
    isDisabledForTurn = false;
    updateStatus({ ctx });
  });

  // Count consecutive explore tool calls
  pi.on("tool_result", async (_event, ctx) => {
    consecutiveExploreCount++;
    updateStatus({ ctx });
  });

  // Check threshold before each explore tool call
  pi.on("tool_call", async (event, ctx) => {
    if (isDisabledForTurn) return;

    if (!EXPLORE_TOOLS.has(event.toolName)) {
      // Write/edit calls are intentional actions, not exploration.
      // Reset the counter since the agent is doing real work.
      consecutiveExploreCount = 0;
      hasInjectedCheckIn = false;
      updateStatus({ ctx });
      return;
    }

    if (consecutiveExploreCount >= THRESHOLD && !hasInjectedCheckIn) {
      hasInjectedCheckIn = true;
      consecutiveExploreCount = 0;
      updateStatus({ ctx });

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
