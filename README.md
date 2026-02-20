# pi-kit

Personal [pi](https://pi.dev) extensions, skills, and themes.

## Extensions

- **context-usage** - Custom footer with model, tokens, cost, context bar, and git branch.
- **shell-preprocessor** - Expand `$`command`` in prompts before the agent sees them.
- **handoff** - `/handoff` command to transfer context to a new focused session.
- **plan-mode** - `/plan` read-only exploration mode with step extraction and progress tracking. `Ctrl+Alt+P` to toggle.
- **safe-commit** - Prompts for confirmation before git commits.
- **safe-delete** - Intercepts destructive bash commands: rm on protected/large paths, find -delete, recursive chmod/chown, git clean -fdx, xargs rm, dd to devices, mkfs, mv to /dev/null, sudo escalation, wildcard explosions.
- **dora** - Lifecycle hooks for dora code intelligence CLI.
- **file-tracker** - Tracks files touched in a session with +/- line counts in a tree widget. `/files` command for full-screen view, overlay always visible.
- **explore-guard** - Passive guardrail that blocks the agent after consecutive read/explore calls without user input, forcing it to pause and summarize before continuing. `/explore` to bypass for one turn.
- **auto-commit-nudge** - Nudges the agent to commit after several file writes without a git commit.
- **run-confirm** - Confirms before expensive bash commands (builds, test suites, generators, deploys, installs).
- **thinking-stash** - Captures thinking tokens during streaming. `/rethink` re-injects them into the next turn after an interruption.
- **verbosity-leash** - System prompt injection enforcing concise commit messages, PR descriptions, changelogs, and docs.
- **tmux-redirect** - Blocks inline long-running processes (dev servers, watchers) and redirects the agent to use tmux.

## Skills

- **cloudflare-api** - Cloudflare developer documentation index for looking up resources.
- **commit-helper** - Generates conventional commit messages from staged changes.
- **git-fix** - Diagnoses and fixes diverged git branches.
- **playwright-cli** - Browser automation command reference for playwright-cli.
- **pr-helper** - Creates GitHub pull requests via `gh` CLI.
- **pi-costs** - Analyze pi session costs, token usage, and statistics.
- **release-helper** - Automates git tags and GitHub releases.
- **tmux-helper** - Interact with tmux sessions, windows, and panes. Covers capture-pane, send-keys, tmuxinator, and common server management patterns.
- **wrangler-ops** - Operational patterns for Cloudflare Wrangler CLI: deploy with local configs, D1 migrations, queries, R2 management, type generation.
- **changeset-helper** - Manage changelogs and versioning with the changesets CLI: creating changesets, consuming for releases, bump types.

## Themes

- **butttons** - Catppuccin Mocha-based theme.
