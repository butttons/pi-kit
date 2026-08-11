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

### Workflow

| Extension              | Description                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **plan-mode**          | `/plan` read-only exploration mode with step extraction and progress tracking. `Ctrl+Alt+P` to toggle. Uses `dora` if available                       |
| **handoff**            | `/handoff` command to transfer context to a new focused session.                                                                                      |
| **thinking-stash**     | Captures thinking tokens during streaming. `/rethink` re-injects them into the next turn after an interruption.                                       |
| **shell-preprocessor** | Expand `` $`command` `` in prompts before the agent sees them.                                                                                        |
| **session-recall**     | `/recall <query>` searches past sessions using a TOON-formatted index. `--compact` for a slimmer index.                                               |
| **lazy-agents**        | Loads AGENTS.md files on demand as the agent touches directories within the project. Avoids context bloat from loading all project rules upfront.        |

### UI

| Extension         | Description                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| **context-usage** | Custom footer with model, tokens, cost, context bar, and git branch.                                     |

### Integrations

| Extension      | Description                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dora**       | Lifecycle hooks for [dora](https://github.com/butttons/dora) code intelligence CLI.                                                                                     |
| **exa-search** | Web search via [Exa AI](https://exa.ai). Set `EXA_API_KEY`, then use `exa_search` tool for real-time web search with highlights.                                        |

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
| **wrangler-ops**   | Operational patterns for Wrangler CLI: deploy, D1 migrations, queries, R2 management, type generation. |
| **pocketbase** | PocketBase backend work: collections, records, auth, realtime, files, hooks, migrations, and the JS/Go SDKs. |

### Knowledge

| Skill   | Description                                                                                                                                                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **obi** | Query Obsidian vaults via the [obi](https://github.com/butttons/obi) CLI. Use for any vault data lookup instead of grep or find -- searching, filtering by frontmatter, reading sections, checking backlinks, finding unread or recent notes. |

### Tools

| Skill              | Description                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **beans**          | Manage tasks, bugs, and features with the [beans](https://github.com/hmans/beans) issue tracker. |
| **playwright-cli** | Browser automation command reference for playwright-cli.                                         |
| **pi-costs**       | Analyze pi session costs, token usage, and statistics.                                           |
| **tanstack-start** | Build full-stack React apps with TanStack Start: routing, server functions, middleware, deployment. |
| **herdr-pi-subagents** | Taskflow-first subagent orchestration in herdr: pi-taskflow (/tf) as the backbone for multi-phase flows (verify, plan, run, resume, save), plain pi-herdr-agents subagent for one-off delegations, with pinned model tiers. |

## Themes

| Theme        | Description                                                               |
| ------------ | ------------------------------------------------------------------------- |
| **butttons** | [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha-based theme. |
