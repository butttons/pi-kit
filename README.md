# pi-kit

Personal [pi](https://pi.dev) extensions, skills, and themes.

## Install

Install everything:

```bash
pi install git:github.com/butttons/pi-kit
```

Cherry-pick specific resources by editing `~/.pi/agent/settings.json` (or `.pi/settings.json` for project-level):

```json
{
  "packages": [
    {
      "source": "git:github.com/butttons/pi-kit",
      "extensions": [
        "extensions/safe-delete.ts",
        "extensions/context-usage.ts",
        "extensions/plan-mode"
      ],
      "skills": ["skills/commit-helper", "skills/pr-helper"],
      "themes": []
    }
  ]
}
```

- Omit a key to load all of that type.
- Use `[]` to load none of that type.
- Use `!pattern` to exclude specific items.

After install, run `pi config` to enable/disable individual resources from the TUI.

## Extensions

### Safety and Guardrails

| Extension         | Description                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **safe-delete**   | Intercepts destructive bash commands: `rm` on protected/large paths, `find -delete`, recursive `chmod`/`chown`, `git clean -fdx`, `dd` to devices, wildcard explosions, and more. |
| **safe-commit**   | Prompts for confirmation before git commits.                                                                                                                                      |
| **run-confirm**   | Confirms before expensive bash commands (builds, test suites, generators, deploys, installs).                                                                                     |
| **explore-guard** | Blocks the agent after consecutive read/explore calls without user input, forcing a pause. `/explore` to bypass for one turn.                                                     |
| **tmux-redirect** | Blocks inline long-running processes (dev servers, watchers) and redirects the agent to use tmux.                                                                                 |

### Workflow

| Extension              | Description                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **plan-mode**          | `/plan` read-only exploration mode with step extraction and progress tracking. `Ctrl+Alt+P` to toggle. Uses `dora` if available |
| **handoff**            | `/handoff` command to transfer context to a new focused session.                                                                |
| **auto-commit-nudge**  | Nudges the agent to commit after several file writes without a git commit.                                                      |
| **thinking-stash**     | Captures thinking tokens during streaming. `/rethink` re-injects them into the next turn after an interruption.                 |
| **shell-preprocessor** | Expand `` $`command` `` in prompts before the agent sees them.                                                                  |
| **verbosity-leash**    | System prompt injection enforcing concise commit messages, PR descriptions, changelogs, and docs.                               |

### UI

| Extension         | Description                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| **context-usage** | Custom footer with model, tokens, cost, context bar, and git branch.                                    |

### Integrations

| Extension | Description                                                                         |
| --------- | ----------------------------------------------------------------------------------- |
| **dora**  | Lifecycle hooks for [dora](https://github.com/butttons/dora) code intelligence CLI. |

## Skills

### Git and Releases

| Skill                | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| **commit-helper**    | Generates conventional commit messages from staged changes. |
| **pr-helper**        | Creates GitHub pull requests via `gh` CLI.                  |
| **release-helper**   | Automates git tags and GitHub releases.                     |
| **changeset-helper** | Manage changelogs and versioning with the changesets CLI.   |
| **git-fix**          | Diagnoses and fixes diverged git branches.                  |

### Infrastructure

| Skill              | Description                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| **cloudflare-api** | Cloudflare developer documentation index for looking up resources.                                     |
| **wrangler-ops**   | Operational patterns for Wrangler CLI: deploy, D1 migrations, queries, R2 management, type generation. |

### Tools

| Skill              | Description                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **tmux-helper**    | Interact with tmux sessions, windows, and panes. Covers capture-pane, send-keys, and tmuxinator. |
| **playwright-cli** | Browser automation command reference for playwright-cli.                                         |
| **pi-costs**       | Analyze pi session costs, token usage, and statistics.                                           |

## Themes

| Theme        | Description                                                               |
| ------------ | ------------------------------------------------------------------------- |
| **butttons** | [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha-based theme. |
