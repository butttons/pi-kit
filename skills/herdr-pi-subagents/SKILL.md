---
name: herdr-pi-subagents
description: "Orchestrate subagents in herdr from pi fabric using the plain subagent tool (pi-herdr-agents). Covers exact fabric_exec call shapes, model tiers, parallel spawn patterns, and hard-won gotchas. Use for any delegation: single one-off tasks or parallel fan-out."
---

# Herdr subagents: plain subagent orchestration

All subagent work runs through **pi-herdr-agents**, driven from the main session via `fabric_exec`:

- `extensions.subagent` — spawn a sub-agent in a dedicated herdr pane (or embedded).
- `extensions.subagents_list` / `subagent_interrupt` / `subagent_resume` — manage running agents.

Keep it basic: one agent per task, parallel spawns for fan-out, results steer back to the main session. No DAG runtimes, no flow DSLs.

## Model roster (user-pinned — always pass explicitly)

| Tier | Model | When |
|---|---|---|
| default | `opencode-go/deepseek-v4-flash` | all work unless escalated |
| complex | `kimi-coding/kimi-for-coding` | multi-file logic, subtle contracts |
| ultra | `kimi-coding/k3-256k` | load-bearing design, hard debugging |

Never let a subagent inherit the parent's interactive model silently — pass `model` on every spawn, then verify it took effect in `details.runtimePlan.modelId`.

## Thinking budget (user preference)

Default to no/low thinking on every spawn. Well-scoped, concise prompts make extra thinking tokens a liability — they derail more than they help. Only raise thinking for genuinely hard debugging or load-bearing design, and say why when you do.

Gotcha: supported thinking levels vary per model — `opencode-go/deepseek-v4-flash` accepts only `off`/`high`/`max` (passing `"low"` errors at spawn). Use `thinking: "off"` for flash. Check the error message for a model's supported values if a spawn fails.

## Spawning

```ts
const res = await extensions.subagent({
  name: "slice-name",                 // display name
  task: "…self-contained prompt…",    // paths, context, constraints, expected output
  model: "opencode-go/deepseek-v4-flash",
  thinking: "off",                    // default; see "Thinking budget" below (flash supports off/high/max only)
  cwd: "<absolute path to the repo>",
  // agent: "worker" | "scout" | "reviewer" | ... (pi-herdr-agents roles)
  // worktree: { branch: "feat/x", base: "main" }  // for parallel WRITING tasks
});
// res.details: { id, sessionFile, status: "started", runtimePlan: { modelId, ... } }
```

## Hard rules (learned from failures)

- **Fire-and-forget.** The call returns `started` immediately and the harness steers the result back as a wake-up message. NEVER poll, sleep, tail the session file, or call `subagents_list` to "check status" — end your turn and wait for the steer. Never fabricate results after spawning.
- **Parallel fan-out**: call `subagent` multiple times in one `fabric_exec` block; results steer back independently. Read-only agents share the parent checkout; parallel writers each get a unique `worktree` branch (uncommitted parent changes are NOT copied).
- **Interrupt**: `await extensions.subagent_interrupt({ id: "<id>" })` (id from spawn details) — turn-level cancel, session stays alive.
- **Resume/help**: a child can `caller_ping` for help; answer with `await extensions.subagent_resume({ sessionPath, message, autoExit: true })`.
- **Self-contained prompts.** Subagents start blank — every prompt must carry: exact file paths, live-environment facts (e.g. current herdr pane ids, from `fleet_survey` when relevant), the agent's own name, constraints (no git commit/push, repo conventions), and the verification command if any. Never tell a subagent to run herdr pane discovery itself or to start duplicate dev servers.
- If a task is really 2 lines, do it yourself — don't spawn.

## Workflow loop (the user's core loop)

1. **Scope first.** Read the target files yourself, propose the agent slice (how many agents, which files, which model tier) and get explicit user approval BEFORE spawning.
2. **Survey before fan-out.** For "look at the whole codebase" requests, spawn ONE scout agent first (read-only, cheapest tier); when its report steers back, review with the user, then spawn one worker per discovered item.
3. **Spawn** with self-contained prompts and pinned models.
4. **End turn.** Wait for steer-backs; synthesize results when they arrive.
5. The user reviews output — do not build review/adversarial agent steps into workflows unless asked.

## Subagent tool discipline (learned from transcript analysis)

Put these rules verbatim in every spawn prompt where the agent will search or read code:

- **Search with structured tools**: `pi.grep` / `pi.find` / `pi.ls` (or `ffgrep`/`fffind` when available) instead of hand-rolled `grep`/`find` via `pi.bash`. Hand-written `grep -E` patterns with literal parens/brackets/\s regularly crash GNU grep (`parentheses not balanced`, `empty (sub)expression`).
- **If `pi.bash` is unavoidable, always pass `settle: true`** and treat grep exit-1 (no match) as an empty result, not an error. Without `settle`, a no-match grep throws a hard Runtime error.
- **Never retry a broken grep pattern** — if a search pattern errored once, switch to `pi.grep` (or literal mode) instead of resending a variant of the same pattern.
- **Read files with `pi.read`, never `cat`/`sed` through `pi.bash`** (repo rule; also pi.read's section view replaces `sed -n` line ranges).
- Evidence: in a 5-subagent transcript audit, the only agent with zero friction on risky greps used `settle: true` everywhere; the cleanest agents used `pi.grep`/`pi.read` exclusively. Model tier was not the differentiator.

## Standing rules (user)

- Only the orchestrator (main session) or the user runs git commit/push. Subagents never commit — put it in every prompt.
- Spawn subagents only when the user explicitly asks; the user dictates the slice and model tier.
- Review of subagent output is the user's job — no review/adversarial steps unless requested.
- No emojis anywhere.
