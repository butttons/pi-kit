# pi-kit

Personal [pi](https://pi.dev) extensions, skills, and themes.

Universal, harness-agnostic skills (git workflows, obi, playwright-cli, dora, exe-dev, ...) live in [agents.dotfiles](https://github.com/butttons/agents.dotfiles) and are loaded directly by every harness. pi-kit keeps only what is pi-specific.

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
      "skills": ["skills/pi-costs"],
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

| Extension       | Description                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **safe-delete** | Intercepts destructive bash commands: `rm` on protected/large paths, `find -delete`, recursive `chmod`/`chown`, `git clean -fdx`, `dd` to devices, wildcard explosions, and more. |
| **safe-commit** | Prompts for confirmation before git commits.                                                                                                                                      |

### Context Management

| Extension          | Description                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **fold**           | `/fold [label]` folds conversation history into a sentinel marker to keep context manageable. The sentinel carries a truncated prose digest for coarse recollection; `search_folded` returns structured hits (stable ids, previews) and `get_folded_message(id)` fetches one full message. Full dumps are impossible by construction. |
| **context-usage**  | Custom footer: `↑` input tokens with cache hit %, `↓` cumulative output, cost, context bar (fold-aware, computed over post-fold messages), project name, and git branch.                                                                            |
| **thinking-stash** | Captures thinking tokens during streaming. `/rethink` re-injects them into the next turn after an interruption.                                                                                                                                     |
| **lazy-agents**    | Loads AGENTS.md files on demand as the agent touches directories within the project. Avoids context bloat from loading all project rules upfront.                                                                                                   |

### Workflow

| Extension              | Description                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **plan-mode**          | `/plan` read-only exploration mode with step extraction and progress tracking. `Ctrl+Alt+P` to toggle. Uses `dora` if available. |
| **handoff**            | `/handoff` command to transfer context to a new focused session.                                         |
| **session-recall**     | `/recall <query>` searches past sessions using a TOON-formatted index. `--compact` for a slimmer index.  |
| **shell-preprocessor** | Expand `` $`command` `` in prompts before the agent sees them.                                           |
| **agent-watch**        | Periodically scans subagent activity files and injects status messages (turn index, activity, stall counter) so the orchestrator can see which agents are progressing. |

### Docs Integrity

| Extension     | Description                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **bash-docs** | Runs bash inside ```` ```auto:bash ```` blocks at read time so generated doc sections (AGENTS.md, SKILL.md) can't drift. |

### Integrations

| Extension          | Description                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dora**           | Lifecycle hooks for [dora](https://github.com/butttons/dora) code intelligence CLI.                                                                                     |
| **exa-search**     | Web search via [Exa AI](https://exa.ai). Set `EXA_API_KEY`, then use `exa_search` tool for real-time web search with highlights.                                        |
| **opencode-usage** | `/usage` command that queries the opencode go usage endpoint (rolling/weekly/monthly). Uses the `opencode-go` provider key from pi auth.                                |
| **command-code**   | Registers the [Command Code](https://commandcode.ai/provider) provider API: live-fetches the model list and exposes it as `command-code` (OpenAI-compatible) and `command-code-anthropic` (Claude models). Uses the `command-code` key from pi auth. |
| **poolside**       | Registers the [Poolside](https://poolside.ai) inference API as the `poolside` provider (OpenAI-compatible). Live model list; uses the `poolside` key from pi auth.      |

## Skills

### pi-specific

| Skill                   | Description                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **herdr-pi-subagents**  | Plain subagent orchestration in herdr via pi-herdr-agents: fabric_exec call shapes, parallel fan-out, pinned model tiers, and the survey-then-fan-out workflow loop. |
| **pi-costs**            | Analyze pi session costs, token usage, and statistics.                                                                                                              |

## Themes

| Theme        | Description                                                               |
| ------------ | ------------------------------------------------------------------------- |
| **butttons** | [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha-based theme. |
