---
name: herdr-pi-subagents
description: "Orchestrate subagents in herdr from pi using the plain subagent tool. Covers spawn patterns, model tiers, parallel fan-out, and hard-won gotchas. Use for any delegation: single one-off tasks or parallel fan-out."
---

# Herdr subagents: plain subagent orchestration

All subagent work runs through the **plain `subagent` tool** driven from the main session:

- `subagent` — spawn a sub-agent in a dedicated herdr pane (or an isolated Git worktree).
- `subagents_list` / `subagent_interrupt` / `subagent_resume` — manage running agents.
- `intercom` — coordinate with live subagent sessions mid-run.

Keep it basic: one agent per task, parallel spawns for fan-out, results steer back to the main session automatically. No DAG runtimes, no flow DSLs, no external orchestration runtime.

**Never pass the `agent` param — always spawn bare with fully explicit params.** Bundled roles (`scout`, `worker`, `reviewer`, etc.) carry derived, restricted tool sets that silently DENY calls the model expects to have; a denied call plus low thinking is a death spiral (observed: an agent re-issuing identical denied calls in a hot loop until killed, burning tokens the whole time). The user deletes bundled roles from the installed package; reinstall restores them — delete again after upgrades. Vocabulary trap: when the user says "scout"/"worker"/"reviewer" they mean the ACTIVITY (investigate / implement / check work) — never the role. Put the activity in the task prompt, leave `agent` unset.

**Always pass `model` AND `thinking` explicitly on every spawn.** Never omit `thinking` to "inherit" — inherited levels route unpredictably per model (observed: a spawn landing on thinking `off`, leaving it no budget to recover from a tool denial).

## Model roster (user-pinned — always pass explicitly)

| Tier | Model | When |
|---|---|---|
| default | `opencode-go/glm-5.3-flash` | all subagent work (user-pinned 2026-08-31) — cheap, fast, concrete |
| backup | `opencode-go/deepseek-v4-flash` (thinking `max`) | when glm flakes or is unavailable |
| legacy | `command-code/xiaomi/mimo-v2.5`, `opencode-go/mimo-v2.5`, `kimi-coding/kimi-for-coding` | previous rosters; only if the user asks |

Thinking levels for glm-5.3-flash are unverified — on first spawns, check the spawn error message for supported values and record the working level here.

Never let a subagent inherit the parent's interactive model silently — pass `model` on every spawn.

## Thinking budget (user preference)

Default to no/low thinking on every spawn. Well-scoped, concise prompts make extra thinking tokens a liability — they derail more than they help. Only raise thinking for genuinely hard debugging or load-bearing design, and say why when you do.

Gotcha: supported thinking levels vary per model and a bad value fails the spawn.

## Spawning

```
subagent({
  name: "slice-name",                 // display name
  task: "…self-contained prompt…",    // paths, context, constraints, expected output
  model: "opencode-go/glm-5.3-flash",
  thinking: "low",                    // default; omit only if unsure of supported levels
  cwd: "<absolute path to the repo>",
  // worktree: { branch: "feat/x", base: "main" }  // for parallel WRITING tasks
});
```

Details from the acknowledgement include the session path and status. Worktree runs retain their workspace after completion for parent review; they are not pushed, merged, or removed automatically.

## Hard rules (learned from failures)

- **Fire-and-forget.** The call returns an acknowledgement immediately — that only means the launch was dispatched. After spawning, either end the turn or work on other independent tasks. **NEVER poll, sleep, tail the session file, or call `subagents_list` to "check status"** — the harness delivers results automatically as a steer message when the sub-agent finishes. A silently dead agent sends nothing, ever. Never fabricate results after spawning.
- **Parallel fan-out**: call `subagent` multiple times in one turn; results steer back independently. Read-only agents share the parent checkout; parallel writers each get a unique `worktree` branch (uncommitted parent changes are NOT copied — the worktree base is committed state).
- **Interrupt**: `subagent_interrupt({ id })` (id from spawn details) — turn-level cancel; the pane, session, and watcher stay alive.
- **Resume/help**: `subagent_resume({ sessionPath, message, autoExit })` continues a dead or interrupted session.
- **Self-contained prompts.** Subagents start blank — every prompt must carry: exact file paths, live-environment facts (exact herdr pane ids from your own survey), the agent's own name, constraints (no git commit/push, repo conventions), and the verification command if any. Never tell a subagent to run herdr pane discovery itself or to start duplicate dev servers.
- If a task is really 2 lines, do it yourself — don't spawn.

## Workflow loop (the user's core loop)

1. **Scope first.** Read the target files yourself, propose the agent slice (how many agents, which files, which model tier) and get explicit user approval BEFORE spawning.
2. **Survey before fan-out.** For "look at the whole codebase" requests, spawn ONE scout agent first (read-only, cheapest tier); when its report steers back, review with the user, then spawn one worker per discovered item.
3. **Spawn** with self-contained prompts and pinned models.
4. **End turn.** Wait for steer-backs; synthesize results when they arrive.
5. The user reviews output — do not build review/adversarial agent steps into workflows unless asked.

## Reading other sessions

When an agent (or the orchestrator) needs data from other sessions — audits, recalling past decisions, checking a subagent's transcript — read the session `.jsonl` files directly (paths come from spawn details or `~/.pi/agent/sessions/`). `jq`/python over JSONL is fine. The `session-recall` extension (`/recall`) provides an index when searching past sessions interactively.

## Subagent tool discipline (learned from transcript analysis)

Put these rules verbatim in every spawn prompt where the agent will search or read code:

- **Search with structured tools**: `ffgrep` / `fffind` when available; otherwise careful literal `grep -F` patterns. Hand-written `grep -E` patterns with literal parens/brackets/\s regularly crash GNU grep (`parentheses not balanced`, `empty (sub)expression`).
- **Never retry a broken grep pattern** — if a search pattern errored once, switch to a structured tool (or literal mode) instead of resending a variant of the same pattern.
- **Read files with the read tool, never `cat`/`sed` via bash.**
- Evidence: in a 5-subagent transcript audit, the cleanest agents used structured search/read tools exclusively. Model tier was not the differentiator.

## Monitoring and anomaly escalation

Fire-and-forget means no polling for COMPLETION, but DO watch running agents for stalls when work is in flight:

- **Cadence (user rule)**: check each running subagent every 10 minutes minimum, and on EVERY wake-up check ALL agents, not just the one that steered back (`herdr pane list`, then `herdr pane read <pane-id> | tail`). Never enforce cadence with blocking sleeps inside a turn: incoming messages cancel long calls and stall harvesting. Monitoring is event-driven: wake up, check everything, act, end turn. If 30 minutes pass without a steer-back or visible progress, investigate for sure — read the pane, diagnose the stall, and decide: corrective `subagent_resume` steer, interrupt + respawn, or escalate to the user.
- **Denial/retry loops are the top token-burner — detect them in the first minutes, not after 10.** Signature in the pane tail: the same tool calls reappear with climbing call ids and no new information between them. A denied tool call retried verbatim even ONCE is a red flag; twice = kill it (`subagent_interrupt`), respawn bare with explicit thinking, and adjust the prompt (name the exact tools it has).
- **A confident completion is not proof of work — fabricated results are a real failure mode.** Observed: an agent returned a rich, correct-looking report (file paths, quoted file contents, import graphs) with ZERO tool calls in its transcript — it invented the whole session inline, and a downstream worker then had to "correct the false premise". When a steer-back makes concrete factual claims (file contents, line numbers), spot-check one claim against the transcript's tool calls before trusting it; zero tool calls + detailed report = fabricated, redo the task with "verify against reality" emphasized in the prompt.
- **Tool calls are not proof either — spot-check VARIATION, not just existence.** Second observed fabrication mode: every claim is "backed" by a tool call, but all calls share the same flawed pattern (e.g. grepping a term that cannot match the real code, then reporting whatever the miss implies). One call shape, wrong premise, confident conclusions. When reviewing evidence, check that the agent varied its queries/reads enough to have actually seen the thing it describes.
- **"Pre-existing failure" claims must be proven against HEAD.** Observed: a worker broke generated types, typecheck failed, and it dismissed the failure as pre-existing without checking. Rule for every agent prompt that runs verification: before claiming a failure pre-dates your change, prove it with `git show HEAD:<path>` / `git stash` + rerun. No baseline, no dismissal.
- **The other anomaly is semantic, not silence**: the agent is stuck on ONE sub-problem across 3-4+ turns without progress — e.g. typecheck fails, fix, fails the same way, fix, fails again; or re-attempting the same edit/command with cosmetic variations. Output volume is irrelevant; an agent can be busy and still be spinning. When you read a pane, ask: "what is it trying to solve right now, and how many turns has it spent on exactly that?"
- **Response ladder**:
  1. `intercom({ action: "send" })` with a corrective steer (cheap, keeps progress).
  2. `subagent_interrupt({ id })` then resume/respawn fresh at a higher thinking level (costs in-flight progress).
  3. **Thinking-level bumps on a LIVE session are a TUI-only lever** — the orchestrator cannot change model/thinking mid-run. Ping the user: "agent X is stuck, bump its thinking in the pane" (user steers panes directly).

## Planner self-consistency gate (plan-verifier prompts)

Meta-analysis of a 10-transcript batch: 75% of reviewer-caught bugs traced to PLAN inconsistencies, not worker sloppiness — e.g. a plan prescribing state `string | null` while its own resolution path needed `"all"` in state; a plan naming two different production datasets in two sections. Workers faithfully implement self-contradicting plans.

Every planner/plan-verifier prompt must include this gate verbatim:

> Before returning the plan, symbol-trace every prescription: for each value a downstream step references (enum member, sentinel, field name, dataset, file path), confirm an upstream step in THIS SAME PLAN actually produces or defines it. If the resolution reads a value no setter writes, or section B names a different artifact than section A, fix the plan before submitting.

## Resume template

When a steer-back dies mid-task or an agent must continue after an interrupt, resume — do not respawn from scratch:

```
subagent_resume({
  sessionPath: "<absolute .jsonl path from spawn details>",
  message: "Check the working tree first, continue from where you left off.",
  autoExit: true,
});
```

The recovery message is deliberately generic — the agent re-reads the repo state and reconciles against its own transcript. Add specifics only when you know exactly which step failed.

## Coordinating LIVE agents: intercom, never resume

`subagent_resume` on a RUNNING agent spawns a second session copy (user caught this; the resume-session then competes with the original). Resume is strictly a recovery tool for DEAD sessions. To steer running agents, use intercom:

- Discover live agents: `intercom({ action: "list" })` — spawned agents appear as `subagent-chat-<uuid>`; status column shows `thinking` / `tool:<name>` / `idle` (use it to distinguish "stuck" from "working" before intervening).
- Send a steer: `intercom({ action: "send", to: "<short-id>", message })` — fire-and-forget; the agent picks it up at its next turn boundary.
- Never use `ask` from the orchestrator — do not block a turn waiting on a reply.

## Parallel writers on a SHARED stateful backend

Worktree isolation breaks when the task exercises shared live state (local databases, dev servers) that exists only in the main checkout. For e2e/test-writing fan-outs:

- Spawn writers in the MAIN checkout, each owning a disjoint folder (`e2e/<domain>/`), with an explicit forbidden-files list (shared config, helpers, fixtures).
- Warn workers in the prompt that N agents share one backend and any global-setup/seed step races: "if state briefly vanishes mid-run, re-run once before debugging." An identical-content reseed makes these races benign.
- A crashed shared server looks like mass test failure (all domains timing out at once). Tell workers: on en-masse failure, STOP and report; the orchestrator checks server panes (herdr) and restarts.

## Long verification commands exceed tool timeouts

Full-suite runs often exceed the 2-minute bash ceiling. Put this in worker prompts for long verifications: run with output redirected (`nohup pnpm e2e > /tmp/run.log 2>&1 &`) and poll the file with `sleep` + `tail`, never block on the command itself.

## Planner → plan files → worker fan-out (proven pattern)

For multi-domain build-outs, one planner agent writing `plans/<domain>.md` (pinned fixture rows, source-verified selectors with evidence quotes, skip lists) then one worker per plan file produced 88/88 implementable cases in one pass. Keys: the planner must quote evidence from the real source for every selector it prescribes, the orchestrator spot-checks 1-2 claims before fan-out, and workers report plan deviations back so plans get a corrections appendix.

## Recovery protocol for dead agents

1. Read the session transcript tail yourself (path in the failure notice) to see what completed.
2. `subagent_resume({ sessionPath, message, autoExit: true })` with a targeted "continue from X" message — resume preserves progress; provider stream errors recover cleanly this way.
3. Respawn fresh only when the transcript shows the session is unsalvageable.

## Standing rules (user)

- Only the orchestrator (main session) or the user runs git commit/push. Subagents never commit — put it in every prompt.
- Spawn subagents only when the user explicitly asks; the user dictates the slice and model tier.
- Review of subagent output is the user's job — no review/adversarial steps unless requested.
- No emojis anywhere.
