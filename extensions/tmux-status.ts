/**
 * Tmux Status Extension
 *
 * Shows active tmux sessions/panes in the footer status bar.
 * Toggle /tmux to display a widget with pane details and
 * attach commands for quick copy.
 *
 * Polls tmux state periodically and after tool calls that
 * touch tmux (send-keys, new-window, split-window, etc.).
 */

import { execSync } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

type PaneInfo = {
  session: string;
  window: string;
  windowName: string;
  pane: string;
  command: string;
  isActive: boolean;
};

type TmuxState = {
  panes: PaneInfo[];
  sessionCount: number;
};

const POLL_INTERVAL_MS = 10_000;
const TMUX_COMMAND_PATTERNS = [
  /\btmux\s+send-keys\b/,
  /\btmux\s+new-window\b/,
  /\btmux\s+split-window\b/,
  /\btmux\s+kill-pane\b/,
  /\btmux\s+kill-window\b/,
  /\btmux\s+kill-session\b/,
  /\btmux\s+rename-window\b/,
  /\btmux\s+new-session\b/,
  /\btmuxinator\b/,
];

function isTmuxAvailable(): boolean {
  try {
    execSync("command -v tmux", { timeout: 2000, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function queryTmuxState(): TmuxState | null {
  try {
    const raw = execSync(
      'tmux list-panes -a -F "#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_current_command}\t#{pane_active}"',
      { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();

    if (!raw) return null;

    const panes: PaneInfo[] = raw.split("\n").map((line) => {
      const [session, window, windowName, pane, command, active] = line.split("\t");
      return {
        session,
        window,
        windowName,
        pane,
        command,
        isActive: active === "1",
      };
    });

    const sessions = new Set(panes.map((p) => p.session));

    return { panes, sessionCount: sessions.size };
  } catch {
    return null;
  }
}

function isTmuxCommand({ command }: { command: string }): boolean {
  return TMUX_COMMAND_PATTERNS.some((p) => p.test(command));
}

export default function tmuxStatus(pi: ExtensionAPI): void {
  let isWidgetVisible = false;
  let currentState: TmuxState | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ctx reference kept across event boundaries
  let currentCtx: ExtensionContext | null = null;

  function updateStatus({ ctx }: { ctx: ExtensionContext }): void {
    if (!currentState || currentState.panes.length === 0) {
      ctx.ui.setStatus("tmux-status", undefined);
      updateWidget({ ctx });
      return;
    }

    const { panes, sessionCount } = currentState;

    // Count unique windows
    const windows = new Set(panes.map((p) => `${p.session}:${p.window}`));

    // Find non-shell commands (interesting processes)
    const runningProcesses = panes
      .map((p) => p.command)
      .filter((cmd) => !["bash", "zsh", "sh", "fish"].includes(cmd));

    const parts: string[] = [];
    parts.push(`${sessionCount}s/${windows.size}w/${panes.length}p`);

    if (runningProcesses.length > 0) {
      const unique = [...new Set(runningProcesses)];
      const truncated = unique.length > 3
        ? [...unique.slice(0, 3), `+${unique.length - 3}`]
        : unique;
      parts.push(truncated.join(","));
    }

    ctx.ui.setStatus(
      "tmux-status",
      ctx.ui.theme.fg("dim", "tmux ") + ctx.ui.theme.fg("muted", parts.join(" ")),
    );

    updateWidget({ ctx });
  }

  function updateWidget({ ctx }: { ctx: ExtensionContext }): void {
    if (!isWidgetVisible || !currentState || currentState.panes.length === 0) {
      ctx.ui.setWidget("tmux-status", undefined);
      return;
    }

    const { panes } = currentState;

    // Group by session
    const bySession = new Map<string, PaneInfo[]>();
    for (const pane of panes) {
      const existing = bySession.get(pane.session) ?? [];
      existing.push(pane);
      bySession.set(pane.session, existing);
    }

    const lines: string[] = [];
    const theme = ctx.ui.theme;

    for (const [session, sessionPanes] of bySession) {
      lines.push(
        theme.fg("accent", theme.bold(session)) +
          theme.fg("dim", "  tmux attach -t ") +
          theme.fg("muted", session),
      );

      // Group panes by window
      const byWindow = new Map<string, PaneInfo[]>();
      for (const p of sessionPanes) {
        const key = `${p.window}:${p.windowName}`;
        const existing = byWindow.get(key) ?? [];
        existing.push(p);
        byWindow.set(key, existing);
      }

      for (const [windowKey, windowPanes] of byWindow) {
        const [windowIndex, windowName] = windowKey.split(":");
        const nameDisplay = windowName !== windowIndex ? windowName : `window ${windowIndex}`;

        lines.push(
          theme.fg("dim", "  ") +
            theme.fg("muted", nameDisplay) +
            theme.fg("dim", ` (${windowPanes.length} pane${windowPanes.length > 1 ? "s" : ""})`),
        );

        for (const p of windowPanes) {
          const target = `${p.session}:${p.window}.${p.pane}`;
          const isShell = ["bash", "zsh", "sh", "fish"].includes(p.command);
          const cmdColor = isShell ? "dim" : "warning";
          const marker = p.isActive ? theme.fg("success", "> ") : theme.fg("dim", "  ");

          lines.push(
            theme.fg("dim", "    ") +
              marker +
              theme.fg(cmdColor, p.command) +
              theme.fg("dim", `  .${p.pane}  `) +
              theme.fg("dim", target),
          );
        }
      }
    }

    ctx.ui.setWidget("tmux-status", lines);
  }

  function refresh({ ctx }: { ctx: ExtensionContext }): void {
    currentState = queryTmuxState();
    updateStatus({ ctx });
  }

  function startPolling({ ctx }: { ctx: ExtensionContext }): void {
    stopPolling();
    pollTimer = setInterval(() => {
      currentState = queryTmuxState();
      updateStatus({ ctx });
    }, POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  pi.registerCommand("tmux", {
    description: "Toggle tmux pane overview widget",
    handler: async (_args, ctx) => {
      isWidgetVisible = !isWidgetVisible;
      refresh({ ctx });

      if (isWidgetVisible) {
        ctx.ui.notify("Tmux overview visible", "info");
      } else {
        ctx.ui.notify("Tmux overview hidden", "info");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;

    if (!isTmuxAvailable()) return;

    refresh({ ctx });
    startPolling({ ctx });
  });

  pi.on("session_switch", async (_event, ctx) => {
    currentCtx = ctx;
    refresh({ ctx });
  });

  // Refresh after tmux-related tool calls
  pi.on("tool_result", async (event) => {
    if (!currentCtx) return;
    if (event.toolName !== "bash") return;

    const command = (event.input as { command?: string }).command ?? "";
    if (isTmuxCommand({ command })) {
      // Small delay to let tmux settle
      setTimeout(() => {
        if (currentCtx) {
          refresh({ ctx: currentCtx });
        }
      }, 500);
    }
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
    currentCtx = null;
  });
}
