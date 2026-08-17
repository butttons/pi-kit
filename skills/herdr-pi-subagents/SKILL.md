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
| default | `opencode-go/mimo-v2.5` | all subagent work (user-pinned 2026-08-17) |
| complex | `opencode-go/mimo-v2.5-pro` | heavier tasks within the mimo family |
| backup | `opencode-go/deepseek-v4-flash` (thinking `max`) | when mimo flakes or is unavailable |
| backup+ | `opencode-go/deepseek-v4-pro` | backup for complex work |
| legacy | `kimi-coding/kimi-for-coding`, `kimi-coding/k3-256k` | previous roster; only if the user asks |

Thinking levels for the mimo models are unverified — on first spawns use the thinking cascade (try `max`, fall back per the spawn error message) and record the working level here.

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

- **Fire-and-forget AFTER the liveness gate.** The call returns `started` immediately — that only means the launch was dispatched, not that the agent booted. Complete the liveness gate (below) for every spawned agent BEFORE ending your turn, then wait for steer-backs. NEVER poll, sleep, tail the session file, or call `subagents_list` to "check status" beyond that gate. Steer-backs fire ONLY on completion — a silently dead agent sends nothing, ever. Never fabricate results after spawning.
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

## Liveness gate (MANDATORY after every spawn)

A spawn acknowledgement is not a running agent. Observed: six agents reported `started` while their launch commands were mangled by an oh-my-zsh update prompt in the fresh panes (`bash ...` typed, prompt ate the first character, `zsh: command not found: ash`) — and zero steer-backs arrived for hours, because dead agents never notify.

After spawning, before ending the turn, run ONE delayed liveness pass (60-90s) covering every spawned agent:

1. Session file exists: the `.jsonl` path from spawn details has been created on disk.
2. Activity advancing: `<artifacts>/subagent-activity/<id>.json` shows `phase: "active"` with an increasing `sequence`, or the pane status bar shows tokens/tool calls moving.
3. Pane read-back shows the launch command landed INTACT and the agent TUI booted — this is the check that catches shell-prompt interference. Prefer plain `herdr pane read <pane-id> | tail`; `--source recent` has returned empty on live panes.

Any agent failing the gate: relaunch its tracked launch script in the same pane — `herdr pane run <pane> "bash '<launchScriptFile from spawn details>'"` — which preserves the session path and steer-back tracking. Respawn fresh only when the session is unsalvageable. Same recovery for stalls detected later: activity `sequence` unchanged across two checks while peers advance = interrupt (`subagent_interrupt`) and relaunch the script.

Prevention: pty surfaces used for typed launches must be prompt-free — disable shell update naggers/wizards globally (this machine: `zstyle ':omz:update' mode disabled` in `~/.zshrc`).

## Monitoring and anomaly escalation

Fire-and-forget means no polling for COMPLETION, but DO watch running agents for stalls when work is in flight:

- **Cadence (user rule)**: check each running subagent every 10 minutes minimum, and on EVERY wake-up check ALL agents, not just the one that steered back (activity files under `<artifacts>/subagent-activity/`, or `herdr pane read <pane-id> | tail` — pane ids from the spawn acknowledgement or `herdr pane list`). Never enforce cadence with blocking sleeps inside a turn: incoming messages cancel long fabric_exec calls and stall harvesting. Monitoring is event-driven: wake up, check everything, act, end turn. If 30 minutes pass without a steer-back or visible progress, investigate for sure — read the pane, diagnose the stall, and decide: corrective `subagent_resume` steer, interrupt + respawn, or escalate to the user.
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

## Coordinating LIVE agents: intercom, never resume

`subagent_resume` on a RUNNING agent spawns a second session copy (user caught this; the resume-session then competes with the original). Resume is strictly a recovery tool for DEAD sessions. To steer running agents, use pi-intercom:

- Discover live agents: `extensions.intercom({ action: "list" })` — spawned agents appear as `subagent-chat-<uuid>`; status column shows `thinking` / `tool:<name>` / `idle` (use it to distinguish "stuck" from "working" before intervening).
- Broadcast a coordination note: `extensions.intercom({ action: "send", to: "<short-id>", message })` per target, fire-and-forget.
- Agents can escalate back via `contact_supervisor` — answer with `intercom({ action: "reply", ... })`.

## Parallel writers on a SHARED stateful backend

Worktree isolation breaks when the task exercises shared live state (local D1, dev servers) that exists only in the main checkout — a worktree's `--persist-to` state is a different database than the one running servers read. For e2e/test-writing fan-outs:

- Spawn writers in the MAIN checkout, each owning a disjoint folder (`e2e/<domain>/`), with an explicit forbidden-files list (shared config, helpers, fixtures).
- Warn workers in the prompt that N agents share one backend and any global-setup/seed step races: "if state briefly vanishes mid-run, re-run once before debugging." An identical-content reseed makes these races benign.
- A crashed shared server looks like mass test failure (all domains timing out at once). Tell workers: on en-masse failure, STOP and report; the orchestrator checks server panes (herdr) and restarts.

## Long verification commands exceed tool timeouts

Full-suite runs often exceed the 2-minute fabric_exec/bash ceiling. Put this in worker prompts for long verifications: run with output redirected (`nohup pnpm e2e > /tmp/run.log 2>&1 &`) and poll the file with `sleep` + `tail`, never block on the command itself.

## Planner → plan files → worker fan-out (proven pattern)

For multi-domain build-outs, one planner agent writing `plans/<domain>.md` (pinned fixture rows, source-verified selectors with evidence quotes, skip lists) then one worker per plan file produced 88/88 implementable cases in one pass. Keys: the planner must quote evidence from the real source for every selector it prescribes, the orchestrator spot-checks 1-2 claims before fan-out, and workers report plan deviations back so plans get a corrections appendix (documentation scribe pass).

## Recovery protocol for dead agents

1. Read the session transcript tail yourself (path in the failure notice) to see what completed.
2. `subagent_resume({ sessionPath, message, autoExit: true })` with a targeted "continue from X" message — resume preserves progress; provider stream errors ("Stream ended without finish_reason") recover cleanly this way.
3. Respawn fresh only when the transcript shows the session is unsalvageable.

## Mid-run steering via pi-intercom

When a running subagent needs guidance (stuck, heading the wrong way, or missing orchestrator-only context), steer it live instead of waiting for failure:

1. Read its herdr pane first to confirm it is actually stuck, not mid-work: `herdr pane list --workspace <id>`, then `herdr pane read <pane> --source recent`.
2. Find its session via `intercom({ action: "list" })` — subagent sessions show up named `subagent-chat-*`; identify by model and live status.
3. Send a fire-and-forget steer: `intercom({ action: "send", to: <session>, message })`. Keep steers one-way and dense: the context the agent cannot know (cross-agent decisions, conventions, what changed elsewhere on the branch) plus reminders (pathspec commits, escalation rules).
4. Never use `ask` from the orchestrator — do not block a turn waiting on a reply; the agent picks the message up at its next turn boundary. Agents can escalate TO the orchestrator via `contact_supervisor` when pi-subagents supplied bridge metadata.

See the `pi-intercom` skill for the full pattern set (ask/reply, broadcast, attachments).

## Hunk-based review agents (adversarial diff review)

When the user asks for a review pass over a worker's changes and a Hunk session is involved, drive it through the hunk daemon CLI — NEVER run interactive hunk commands (`hunk diff`, `hunk show`) from an agent; the TUI belongs to the user. Bundled usage skill: `hunk skill path`.

Orchestrator pre-check: `hunk session list --json` to confirm a live session exists for the repo (user launches it, e.g. in a herdr pane). If none, tell the user to start `hunk diff` first — do not spawn the reviewer blind.

Review-agent workflow (bake into the prompt verbatim):

1. `hunk session reload --repo <abs-repo-path> -- diff` — refresh the live session so it shows the worker's fresh changes, not a stale snapshot. The session does NOT auto-reload.
2. `hunk session review --repo <abs-repo-path> --include-patch --json` — structured file/hunk list plus raw diff text. Omit `--include-patch` for a structure-only first pass on large diffs.
3. Read the changed files in full with pi.read before judging a hunk — diff context alone fabricates "bugs" that the surrounding code already handles.
4. Report findings back in the steer-back AND drop them inline for the user in one batch:
   `printf '%s' '{"comments":[{"filePath":"...", "newLine":N, "summary":"...", "rationale":"..."}]}' | hunk session comment apply --repo <abs-repo-path> --stdin`
   Use `newLine` for added/changed lines, `oldLine` for deletions. Keep summaries one sentence; rationale carries the why.
5. If the session vanished mid-review (user closed it), fall back to `git diff` for the analysis and return findings as text — never block on the daemon.

Reviewers are read-only: they comment and report, they never edit. Fixes are a separate step (small fixes by the orchestrator, big ones via a fixer agent).

## calldiff — structural behavior check (use before hunk review)

For PRs that claim behavior preservation (refactors, unification passes), run `calldiff diff <base>...<branch>` (scope with pathspecs to the changed app/package) BEFORE the hunk-level review. The call-stack diff should be near-empty: same entrypoints, same call paths, fewer intermediate layers. A vanished call path means a behavior was dropped (e.g. a mutation no longer wired); a brand-new path to a sensitive sink (network, DB, redirect) means scope creep. Investigate either in the hunk review. calldiff is also an MCP server and has agent skills (`calldiff skills` / `calldiff mcp`) if deeper reach/tree queries are needed (`calldiff reach` from an entrypoint to a suspect symbol). Output is LLM-oriented — use `--format md` or `--token-limit` on big diffs.

## Standing rules (user)

- Only the orchestrator (main session) or the user runs git commit/push. Subagents never commit — put it in every prompt.
- Spawn subagents only when the user explicitly asks; the user dictates the slice and model tier.
- Review of subagent output is the user's job — no review/adversarial steps unless requested.
- No emojis anywhere.
