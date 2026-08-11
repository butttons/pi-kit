---
name: herdr-pi-subagents
description: "Orchestrate subagents in herdr from pi fabric: taskflow (/tf) is the backbone for any multi-phase work — consistent plan/verify/run cycles with tracked, resumable, saveable flows. Plain subagent tool only for single one-off delegations. Covers exact fabric_exec call shapes, model tiers, gotchas."
---

# Herdr subagents: taskflow-first orchestration

All subagent work runs through two installed packages, driven from the main session via `fabric_exec`:

- **pi-taskflow** (`extensions.taskflow`) — the backbone. Any request spanning multiple phases, multiple items, or repeated patterns becomes a taskflow flow: declarative DAG, tracked runId, resumable, saveable as `/tf:<name>`.
- **pi-herdr-agents** (`extensions.subagent` + `extensions.subagents_list` / `subagent_interrupt` / `subagent_resume`) — fire-and-forget single delegations in herdr panes. Use ONLY when one delegation with no tracking needs is enough.

Core principle: the user describes the outcome; you translate it into a flow. That gives a consistent planner/worker/reviewer shape every time instead of ad-hoc spawns.

## Model roster (user-pinned — always pass explicitly)

| Tier | Model | When |
|---|---|---|
| default | `opencode-go/deepseek-v4-flash` | all work unless escalated |
| complex | `kimi-coding/kimi-for-coding` | multi-file logic, subtle contracts |
| ultra | `kimi-coding/k3-256k` | load-bearing design, hard debugging |

Never let a subagent inherit the parent's interactive model silently. In taskflow, set the model per phase via the phase's `agent` choice or flow-level config (`pi-taskflow` agents carry their own runtimes; check `action: "agents"`). For plain subagent calls, pass `model` explicitly.

## Taskflow (the default path)

### Call shape

```ts
// inside fabric_exec code
await extensions.taskflow({ action: "verify", defineFile: "/tmp/flow.json" });
await extensions.taskflow({ action: "plan", defineFile: "/tmp/flow.json" });
await extensions.taskflow({ action: "run", defineFile: "/tmp/flow.json" });
```

### Workflow for every non-trivial request

1. **Author**: write the flow JSON to a tmp file with `pi.write` (e.g. `/tmp/feat-x.json`). Never inline big definitions in the call — `defineFile` lets you edit + re-verify without resending.
2. **Verify** (`action: "verify"`) — zero tokens; catches cycles, missing `dependsOn`, undefined refs, contract typos. Iterate on the file until clean.
3. **Plan** (`action: "plan"`) — zero tokens; shows bound/unresolved bindings and worst-case agent-call count. Show the user the plan when the flow is expensive.
4. **Run** (`action: "run"`) — only the `final: true` phase output returns to your context; intermediate transcripts stay in the runtime.
5. **Save** reusable flows: `action: "save"` with `define`, then rerun via `{ action: "run", name: "<flow>", args: {...} }` or `/tf:<name>`.

### Minimal flow skeleton (discover → map → gate → report)

```jsonc
{
  "name": "example",
  "budget": { "maxUSD": 2.00 },
  "phases": [
    { "id": "discover", "type": "agent", "agent": "scout", "output": "json",
      "task": "List the items. Output ONLY a JSON array [...].",
      "expect": { "type": "array" }, "retry": { "max": 2 } },
    { "id": "work", "type": "map", "over": "{steps.discover.json}", "as": "item",
      "agent": "worker", "task": "Do the thing for {item}.", "dependsOn": ["discover"] },
    { "id": "review", "type": "gate", "agent": "reviewer", "output": "json",
      "expect": { "type": "object", "required": ["verdict"],
        "properties": { "verdict": { "enum": ["pass", "block"] } } },
      "task": "Review:\n{steps.work.output}\nRespond ONLY JSON {\"verdict\":\"pass\"|\"block\"}",
      "dependsOn": ["work"] },
    { "id": "report", "type": "reduce", "from": ["review"], "agent": "doc-writer",
      "task": "Summarize:\n{steps.review.output}", "dependsOn": ["review"], "final": true }
  ]
}
```

### Shorthand (skips DSL, still tracked/resumable)

```ts
await extensions.taskflow({ action: "run", task: "Summarize src/ architecture", agent: "scout" });
await extensions.taskflow({ action: "run", tasks: [{ task: "Audit auth" }, { task: "Audit validation" }] });
await extensions.taskflow({ action: "run", chain: [{ task: "List API of src/lib" }, { task: "Write docs for:\n{previous.output}" }] });
```

### Rules that break flows when ignored

- `dependsOn` is the DAG — phase array order means nothing. Every `{steps.X.*}` ref needs `"dependsOn": ["X"]`.
- Hyphenated ids and agent names only. Never invent agent names — `await extensions.taskflow({ action: "agents" })` lists them (18 built-ins: executor, scout, planner, analyst, critic, reviewer, security-reviewer, test-engineer, doc-writer, executor-fast, executor-ui, verifier, …).
- Machine checks before LLM checks: `script` phases (zero tokens) for builds/tests, gate `eval` before gate `task`.
- Decision phases emit JSON with `expect` contracts (enum verdicts), not free text.
- Any fan-out gets a `budget`. Any saved flow gets `strictInterpolation: true`.
- Mark exactly one phase `final: true`.
- Load the full taskflow skill for deep features (loop/tournament/race/expand, incremental recompute): read `/Users/yash/.pi/agent/npm/node_modules/pi-taskflow/skills/taskflow/SKILL.md`.

### Operating runs

- `/tf runs`, `/tf peek <runId> [phaseId]` — inspect stored phases without pulling transcripts into context.
- `action: "resume"` with `runId` — forks a failed/paused run, reuses completed phases.
- `detach: true` on `run` for background; approval phases auto-reject when detached.

## Plain subagent (single one-off delegation only)

```ts
const res = await extensions.subagent({
  name: "slice-name",                 // display name
  task: "…self-contained prompt…",    // paths, context, constraints, expected output
  model: "opencode-go/deepseek-v4-flash",
  cwd: "/Users/yash/Work/zomunk/toolkit-v2",
  // agent: "worker" | "scout" | "reviewer" | ... (pi-herdr-agents roles)
  // thinking: "low" | "medium" | "high"
  // worktree: { branch: "feat/x", base: "main" }  // for parallel WRITING tasks
});
// res.details: { id, sessionFile, status: "started", runtimePlan: { modelId, ... } }
```

Hard rules (learned from failures):

- **Fire-and-forget.** The call returns `started` immediately and the harness steers the result back as a wake-up message. NEVER poll, sleep, tail the session file, or call `subagents_list` to "check status" — end your turn and wait for the steer. Never fabricate results after spawning.
- **Parallel**: call `subagent` multiple times; results steer back independently. Read-only agents share the parent checkout; parallel writers each get a unique `worktree` branch (uncommitted parent changes are NOT copied).
- **Interrupt**: `await extensions.subagent_interrupt({ id: "<id>" })` (from spawn details) — turn-level cancel, session stays alive.
- **Resume/help**: a child can `caller_ping` for help; answer with `await extensions.subagent_resume({ sessionPath, message, autoExit: true })`.
- Verify the model actually took effect in `details.runtimePlan.modelId`.
- Subagents start blank — prompts must be fully self-contained (exact paths, live-environment facts, constraints: no git commit/push, repo conventions, verification command).
- If a task is really 2 lines, do it yourself — don't spawn.

## Which tool when

| Situation | Tool |
|---|---|
| Multi-phase, multi-item, or repeatable work | taskflow flow (`verify` → `plan` → `run`) |
| One-off delegation you want tracked/resumable | taskflow shorthand (`task`/`tasks`/`chain`) |
| Quick background task, user watching its pane | plain `subagent` |
| Parallel independent writes | taskflow `map`/`parallel`, or multiple `subagent` with unique worktrees |
| Human approval mid-flow | taskflow `approval` phase (not detached) |
| Review/adversarial passes | taskflow `gate`/`tournament` phases (review agents) |

## Standing rules (user)

- Only the orchestrator (main session) or the user runs git commit/push. Subagents never commit — put it in every prompt.
- Spawn subagents only when the user explicitly asks; the user dictates the slice and model tier.
- Review of subagent output is the user's job — no review/adversarial steps unless requested.
