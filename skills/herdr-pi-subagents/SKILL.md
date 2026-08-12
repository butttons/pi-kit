---
name: herdr-pi-subagents
description: "Orchestrate subagents in herdr from pi fabric using the plain subagent tool (pi-herdr-agents). Covers exact fabric_exec call shapes, model tiers, parallel spawn patterns, and hard-won gotchas. Use for any delegation: single one-off tasks or parallel fan-out."
---

# Herdr subagents: plain subagent orchestration

All subagent work runs through **pi-herdr-agents**, driven from the main session via `fabric_exec`:

- `extensions.subagent` — spawn a sub-agent in a dedicated herdr pane (or embedded).
- `extensions.subagents_list` / `subagent_interrupt` / `subagent_resume` — manage running agents.
- `extensions.herdr_workflow` — approved multi-role review workflows (prepare → user approves hash → start → one delivery). Author those with pi-herdr-agents' bundled `orchestrate` skill, not this one.

Keep it basic: one agent per task, parallel spawns for fan-out, results steer back to the main session. No DAG runtimes, no flow DSLs.

**Never pass the `agent` param — always spawn bare with fully explicit params.** pi-herdr-agents' bundled roles (`scout`, `worker`, `reviewer`, etc.) carry derived, restricted tool sets that silently DENY calls the model expects to have; a denied call plus low thinking is a death spiral (observed: an agent re-issuing identical denied calls in a hot loop until killed, burning tokens the whole time). The user deletes the bundled roles from the installed package (`rm -rf <pkg>/agents`; reinstall restores them — delete again after upgrades). Vocabulary trap: when the user says "scout"/"worker"/"reviewer" they mean the ACTIVITY (investigate / implement / check work) — never the role. Put the activity in the task prompt, leave `agent` unset.

**Always pass `model` AND `thinking` explicitly on every spawn.** Never omit `thinking` to "inherit" — inherited levels route unpredictably per model (observed: a kimi spawn landing on thinking `off`, leaving it no budget to recover from a tool denial).

## Model roster (user-pinned — always pass explicitly)

| Tier | Model | When |
|---|---|---|
| default | `opencode-go/deepseek-v4-flash` (thinking `max`) | all work unless escalated — 6-for-6 on real tasks 2026-08-11 |
| complex | `kimi-coding/kimi-for-coding` | when deepseek flakes (DSML dump) or contracts get subtle |
| ultra | `kimi-coding/k3-256k` | load-bearing design, hard debugging |

Never let a subagent inherit the parent's interactive model silently — pass `model` on every spawn, then verify it took effect in `details.runtimePlan.modelId`.

`opencode-go/deepseek-v4-flash` thinking-level behavior (probed 2026-08): `max` is verified working across single-call, multi-turn, bash, and write tasks; `high` is FLAKY — a provider-side regression can make spawns die ~13s in, emitting raw DSML tool-call markup as plain text with zero real tool calls and a clean exit. Use `max` with deepseek; if a spawn DSML-dumps, respawn once and otherwise switch models.

## Thinking budget (user preference)

Default to no/low thinking on every spawn. Well-scoped, concise prompts make extra thinking tokens a liability — they derail more than they help. Only raise thinking for genuinely hard debugging or load-bearing design, and say why when you do.

Gotcha: supported thinking levels vary per model and a bad value fails the spawn. When unsure, omit the `thinking` param — the spawn inherits the parent's level. Check the error message for a model's supported values if a spawn fails.

## Spawning

```ts
const res = await extensions.subagent({
  name: "slice-name",                 // display name
  task: "…self-contained prompt…",    // paths, context, constraints, expected output
  model: "kimi-coding/kimi-for-coding",
  thinking: "off",                    // default; omit entirely if unsure of the model's supported levels
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
- **Self-contained prompts.** Subagents start blank — every prompt must carry: exact file paths, live-environment facts (exact herdr pane ids from your own `herdr pane list` survey), the agent's own name, constraints (no git commit/push, repo conventions), and the verification command if any. Never tell a subagent to run herdr pane discovery itself or to start duplicate dev servers.
- If a task is really 2 lines, do it yourself — don't spawn.

## Workflow loop (the user's core loop)

1. **Scope first.** Read the target files yourself, propose the agent slice (how many agents, which files, which model tier) and get explicit user approval BEFORE spawning.
2. **Survey before fan-out.** For "look at the whole codebase" requests, spawn ONE scout agent first (read-only, cheapest tier); when its report steers back, review with the user, then spawn one worker per discovered item.
3. **Spawn** with self-contained prompts and pinned models.
4. **End turn.** Wait for steer-backs; synthesize results when they arrive.
5. The user reviews output — do not build review/adversarial agent steps into workflows unless asked.

## fabric_exec is first-class in subagent prompts — ship the primer

Subagents run in pi-fabric full-code mode where fabric_exec is the tool path, but their captured surface (extensions.*, memory.*, ...) is built PER SESSION and differs from the parent's. Never paste the parent's call shapes (`extensions.read_thread(...)`) into a prompt — they may not exist in the child's session. Instead, every spawn prompt that needs non-core tools must include the primer AND the task-specific tool list:

```
TOOLING (fabric_exec sandbox):
- Core tools are always available as pi.*: pi.read / pi.grep / pi.find / pi.ls / pi.write / pi.edit / pi.bash (pass settle: true on bash).
- Any other loaded tool is reachable by discovery: run await tools.search({ query: "<word>" }) ONCE, then call it via await tools.call({ ref, args }). Do NOT assume bare globals or extensions.* names — your captured surface differs from the parent's.
- Tools you will need for THIS task:
  - read_thread — read a session transcript. Args: { thread_id: <full UUID or absolute .jsonl path>, include_tool_results: true }. Omit max_messages (it truncates to the LAST N).
  - find_threads — search sessions. Args: { query, cwd, limit }. Returns full UUIDs + token/cost metadata.
````

Rules: name only the tools the task actually needs, with VERIFIED semantics (smoke-test a tool yourself before baking its args into prompts). Discovery (tools.search) is a one-time-per-session bridge — tell the agent that explicitly so it doesn't treat "Cannot find name" as a blocker.

Also bake these traps into every primer (all observed biting real subagents):

- **Quote `$` paths in bash**: `z.$org/...`-style contract paths must be single-quoted (`'z.$org/...'`) — the shell expands `$org` to empty and the command silently hits the wrong path.
- **Always `await` pi.* tools**: an unawaited `pi.read(...)` returns `{}` (a pending promise), and the agent then "reads" an empty object and invents the rest. Every pi.* call is async.
- **`π.*` needs the `strings` param**: `π.<key>` only resolves when the spawn's fabric_exec call passes that key via `strings: { key: "..." }`. For large prompt payloads (plans, diffs, checklists), pass them through `strings` and reference `π.<key>` in code — never inline-megabyte template literals.
- **`pi.read` options are `offset`/`limit`, not `length`** — passing `length` silently returns the whole file.

## Reading other sessions — pi-threads first

When an agent (or the orchestrator) needs data from other sessions — audits, recalling past decisions, checking a subagent's transcript — use the pi-threads tools, not raw JSONL parsing:

- `find_threads({ query, cwd, limit })` — ripgrep search across all past sessions; filter by project cwd.
- `read_thread({ thread_id, include_tool_results, max_messages })` — read one thread by session UUID (from the JSONL filename) or path; `include_tool_results: true` for tool-friction audits.

Subagents load the same global extensions, so they have these tools too — name them explicitly in audit/inspection prompts. Raw jq-on-JSONL is the fallback only when read_thread output is insufficient.

## Subagent tool discipline (learned from transcript analysis)

Put these rules verbatim in every spawn prompt where the agent will search or read code:

- **Search with structured tools**: `pi.grep` / `pi.find` / `pi.ls` (or `ffgrep`/`fffind` when available) instead of hand-rolled `grep`/`find` via `pi.bash`. Hand-written `grep -E` patterns with literal parens/brackets/\s regularly crash GNU grep (`parentheses not balanced`, `empty (sub)expression`).
- **If `pi.bash` is unavoidable, always pass `settle: true`** and treat grep exit-1 (no match) as an empty result, not an error. Without `settle`, a no-match grep throws a hard Runtime error.
- **Never retry a broken grep pattern** — if a search pattern errored once, switch to `pi.grep` (or literal mode) instead of resending a variant of the same pattern.
- **Read files with `pi.read`, never `cat`/`sed` through `pi.bash`** (repo rule; also pi.read's section view replaces `sed -n` line ranges).
- Evidence: in a 5-subagent transcript audit, the only agent with zero friction on risky greps used `settle: true` everywhere; the cleanest agents used `pi.grep`/`pi.read` exclusively. Model tier was not the differentiator.

## Monitoring and anomaly escalation

Fire-and-forget means no polling for COMPLETION, but DO watch running agents for stalls when work is in flight:

- **Cadence**: every few minutes, `herdr pane read <pane-id> --source recent-unwrapped --lines 50` on each running subagent pane (get pane ids from the spawn acknowledgement or `herdr pane list`).
- **Denial/retry loops are the top token-burner — detect them in the first minutes, not after 10.** Signature in the pane tail: the badge reads `N tools · N denied` and the same tool calls reappear with climbing call ids and no new information between them. A denied tool call retried verbatim even ONCE is a red flag; twice = kill it (`subagent_interrupt`), respawn bare with explicit thinking, and adjust the prompt (name the exact tools it has). This failure mode burns the entire session's tokens if unwatched.
- **A confident completion is not proof of work — fabricated results are a real failure mode.** Observed: a probe returned a rich, correct-looking report (file paths, quoted file contents, import graphs) with ZERO tool calls in its transcript — it invented the whole session inline, and a downstream worker then had to "correct the false premise". When a steer-back makes concrete factual claims (file contents, line numbers), spot-check one claim against the transcript's toolCall list before trusting it; zero toolCalls + detailed report = fabricated, redo the task with "verify against reality" emphasized in the prompt.
- **Tool calls are not proof either — spot-check VARIATION, not just existence.** Second observed fabrication mode: every claim is "backed" by a tool call, but all calls share the same flawed pattern (e.g. grepping a term that cannot match the real code, then reporting whatever the miss implies). One call shape, wrong premise, confident conclusions. When reviewing evidence, check that the agent varied its queries/reads enough to have actually seen the thing it describes.
- **"Pre-existing failure" claims must be proven against HEAD.** Observed: a worker broke generated types (`cf-typegen` output), typecheck failed, and it dismissed the failure as pre-existing without checking. Rule for every agent prompt that runs verification: before claiming a failure pre-dates your change, prove it with `git show HEAD:<path>` / `git stash` + rerun. No baseline, no dismissal.
- **The other anomaly is semantic, not silence**: the agent is stuck on ONE sub-problem across 3-4+ turns without progress — e.g. typecheck fails, fix, fails the same way, fix, fails again; or re-attempting the same edit/command with cosmetic variations. Output volume is irrelevant; an agent can be busy and still be spinning. When you read a pane, ask: "what is it trying to solve right now, and how many turns has it spent on exactly that?"
- **Response ladder**:
  1. `subagent_resume({ sessionPath, message })` with a corrective steer (cheap, keeps progress).
  2. `subagent_interrupt({ id })` then resume, or respawn fresh at a higher thinking level (costs in-flight progress).
  3. **Thinking-level bumps on a LIVE session are a TUI-only lever** — the orchestrator cannot change model/thinking mid-run (`subagent_resume` has no such param). Ping the user: "agent X is stuck, bump its thinking in the pane" (user steers panes directly).

## Planner self-consistency gate (plan-verifier prompts)

Meta-analysis of a 10-transcript batch: 75% of reviewer-caught bugs traced to PLAN inconsistencies, not worker sloppiness — e.g. a plan prescribing state `string | null` while its own resolution path needed `"all"` in state; a plan naming two different production datasets in two sections. Workers faithfully implement self-contradicting plans.

Every planner/plan-verifier prompt must include this gate verbatim:

> Before returning the plan, symbol-trace every prescription: for each value a downstream step references (enum member, sentinel, field name, dataset, file path), confirm an upstream step in THIS SAME PLAN actually produces or defines it. If the resolution reads a value no setter writes, or section B names a different artifact than section A, fix the plan before submitting.

## Resume template

When a steer-back dies mid-task or an agent must continue after an interrupt, resume — do not respawn from scratch:

```ts
await extensions.subagent_resume({
  sessionPath: "<absolute .jsonl path from spawn details>",
  message: "Check the working tree first, continue from where you left off.",
  autoExit: true,
});
```

The recovery message is deliberately generic — the agent re-reads the repo state and reconciles against its own transcript. Add specifics only when you know exactly which step failed.

## Standing rules (user)

- Only the orchestrator (main session) or the user runs git commit/push. Subagents never commit — put it in every prompt.
- Spawn subagents only when the user explicitly asks; the user dictates the slice and model tier.
- Review of subagent output is the user's job — no review/adversarial steps unless requested.
- No emojis anywhere.
