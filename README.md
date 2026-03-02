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
| **explore-guard** | Blocks the agent after consecutive read/explore calls without user input, forcing a pause. `/explore` to bypass for one turn.                                                     |
| **tmux-redirect** | Blocks inline dev server commands and redirects the agent to use tmux.                                                                                                            |

### Workflow

| Extension              | Description                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **plan-mode**          | `/plan` read-only exploration mode with step extraction and progress tracking. `Ctrl+Alt+P` to toggle. Uses `dora` if available |
| **handoff**            | `/handoff` command to transfer context to a new focused session.                                                                |
| **auto-commit-nudge**  | Nudges the agent to commit after several file writes without a git commit. Off by default, `/commit-nudge` to toggle.            |
| **thinking-stash**     | Captures thinking tokens during streaming. `/rethink` re-injects them into the next turn after an interruption.                 |
| **shell-preprocessor** | Expand `` $`command` `` in prompts before the agent sees them.                                                                  |
| **verbosity-leash**    | System prompt injection enforcing concise commit messages, PR descriptions, changelogs, and docs.                               |
| **session-recall**     | `/recall <query>` searches past sessions using a TOON-formatted index. `--compact` for a slimmer index.                        |
| **brief**              | `/brief <daily\|weekly\|monthly>` generates activity briefs from GitHub commits/PRs and pi session transcripts. Writes markdown to an Obsidian vault. |

### UI

| Extension         | Description                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| **context-usage** | Custom footer with model, tokens, cost, context bar, and git branch.                                    |
| **tmux-status**   | Shows active tmux sessions/panes in the footer. `/tmux` toggles an overview widget with attach commands. |

### Integrations

| Extension  | Description                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dora**   | Lifecycle hooks for [dora](https://github.com/butttons/dora) code intelligence CLI.                                                                        |
| **pencil** | MCP bridge for [Pencil](https://pencil.li) design tool. Discovers tools at load, lazily spawns client. Configure via `PENCIL_MCP_BINARY` / `PENCIL_MCP_ARGS` env vars. |

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

### Knowledge

| Skill        | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| **obi**      | Query Obsidian vaults via the [obi](https://github.com/butttons/obi) CLI. Use for any vault data lookup instead of grep or find -- searching, filtering by frontmatter, reading sections, checking backlinks, finding unread or recent notes. |

### Tools

| Skill              | Description                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **beans**          | Manage tasks, bugs, and features with the [beans](https://github.com/hmans/beans) issue tracker. |
| **tmux-helper**    | Interact with tmux sessions, windows, and panes. Covers capture-pane, send-keys, and tmuxinator. |
| **playwright-cli** | Browser automation command reference for playwright-cli.                                         |
| **pi-costs**       | Analyze pi session costs, token usage, and statistics.                                           |

## Themes

| Theme        | Description                                                               |
| ------------ | ------------------------------------------------------------------------- |
| **butttons** | [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha-based theme. |
