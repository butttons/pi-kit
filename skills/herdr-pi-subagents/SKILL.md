---
name: herdr-pi-subagents
description: "Driving named pi rpc-mode subagents in herdr panes: spawn with per-slice models, prompt via JSON frames, deterministic status waits, live mid-turn visibility via session JSONL, read results from the session file, group panes into labeled workspaces, clean up when done. Default subagent model opencode-go/deepseek-v4-flash."
---

# Driving herdr-hosted pi rpc subagents

Orchestrator pattern: the main session chats with the user and drives work via named pi subagents running in rpc mode inside herdr panes.

## Model roster (user-pinned, 3 tiers — orchestrator picks per slice)

| Tier | Model | When |
|---|---|---|
| default | `opencode-go/deepseek-v4-flash` | all work unless escalated |
| complex | `kimi-coding/kimi-for-coding` | complex slices (multi-file logic, subtle contracts) |
| ultra | `kimi-coding/k3-256k` | ultra-complex slices only (load-bearing design, hard debugging) |

**Always pass `--model` explicitly at spawn, for every tier.** pi's configured `defaultModel` is the user's interactive default (typically k3-256k) — a spawn without `--model` inherits that, not flash. Verify a model id exists with `pi --list-models <pattern>`.

## One-time setup

`herdr integration install pi` — installs `~/.pi/agent/extensions/herdr-agent-state.ts`. Without it, `agent_status` stays `unknown` and deterministic waits don't work. Verify: `herdr integration status` → `pi: current`.

## Workspace grouping — never dump panes into the user's workspace

Subagent panes must NOT accumulate in the user's interactive workspace or in one shared pile. Group them logically:

1. Before a batch of related dispatches, create (or reuse) **one labeled workspace per logical work group** (feature, bug, investigation):
   ```bash
   herdr workspace create --cwd <repo> --label "<group-name>" --no-focus
   # → result.workspace.workspace_id
   ```
2. Spawn all agents of that group into it (`--workspace <wid>`). Two unrelated slices = two workspaces.
3. Close each agent's pane as soon as its result is harvested (`herdr pane close <pane_id>`) — don't leave finished agents lying around.
4. When the whole group is done, close the workspace: `herdr workspace close <wid>`.

The new workspace's root pane is a plain shell — use it for ad-hoc commands/log tails if useful, otherwise ignore it.

Caveat: workspace/tab/pane ids compact when things close — re-survey (`herdr pane list`) before each batch, never reuse ids from an earlier session or from examples.

## Environment context — ALWAYS survey herdr before dispatching

The user runs dev servers and services in herdr panes. Subagents start blank and CANNOT see these panes — if a slice benefits from a live service (browser checks, curl against a dev server, reading server logs), the orchestrator MUST discover it and put it in the prompt. Otherwise agents spawn duplicate servers or work blind.

Before each batch of dispatches:

1. `herdr pane list` — every pane with cwd and agent_status.
2. For panes that look like long-running services: `herdr pane process-info <pane_id>` (foreground process) and/or `herdr pane read <pane_id> --source recent-unwrapped --lines 20` (look for "Local: http://localhost:PORT" banners, server startup lines, pm2 logs).
3. Put the findings in the prompt as **exact ids and ready-to-run commands** — the subagent should never have to run `herdr pane list` or guess ids itself. Also state its own identity so it doesn't read its own pane by mistake.

Prompt boilerplate example (ids are illustrative — always substitute live ones):
> Live environment (already running in herdr panes — do NOT start your own):
> - Dev server: http://localhost:3000 — pane `w3:p2`. Read its logs: `herdr pane read w3:p2 --source recent-unwrapped --lines 50`
> - Database admin: http://localhost:8090 — pane `w3:p3`. Logs: `herdr pane read w3:p3 --source recent-unwrapped --lines 50`
> - You are the agent in pane `w5:p2` (workspace w5); the panes above belong to other workspaces.
> Run those herdr commands verbatim; do NOT run `herdr pane list` or re-discover ids, and do NOT restart any service.

## Lifecycle

1. **Spawn**: `herdr agent start <name> --workspace <wid> --no-focus --cwd <repo> -- pi --mode rpc --model <model> --approve` → returns `result.agent.pane_id`. `--approve` trusts project-local pi config — REQUIRED, because project `.pi/` resources (skills, extensions, settings) are silently ignored in rpc mode without it, and subagents need them. pi has no `--cwd` flag — `--cwd` belongs to `herdr agent start`. Pane ids are transient; address the agent by name afterward. Do NOT pass `--no-session` — the session file is the visibility channel.
2. **Prompt** (rpc frames are newline-delimited JSON on stdin):
   ```bash
   herdr agent send <name> '{"type":"prompt","message":"..."}'
   herdr pane send-keys <pane_id> enter
   ```
3. **Wait**: `herdr agent get <name>` → `result.agent.agent_status` (`idle` → `working` → `done`). `done` = finished and not yet inspected. `herdr agent wait <name> --status done --timeout MS` blocks if you truly have nothing else to do — but prefer checking status between other work; turns can take minutes and long blocking waits annoy the user.
4. **Read the result**: parse the session JSONL for the last assistant text message (snippet in Visibility section) — structured transcript, never scrape pane scrollback for the final answer.
5. **Follow-ups**: send another prompt frame to the same agent — session continuity works. Send only when status is `done`/`idle`; if the agent is still streaming, a bare `prompt` frame is rejected (you'd need `"streamingBehavior": "steer"` or `"followUp"` — simpler to wait).
6. **Interrupt**: `herdr pane send-keys <pane_id> ctrl+c`. **Cleanup**: `herdr pane close <pane_id>`, and `herdr workspace close <wid>` when the group is done.

## Visibility — watching an agent mid-turn

Three levels:

1. **Coarse**: `herdr agent get <name>` → `agent_status` (idle/working/done).
2. **Detailed (primary)**: the session JSONL is LIVE — `herdr agent get <name>` → `agent_session.value` is the full file path. pi appends every message as it happens. Format: one JSON object per line, `type:"message"` events with `message.role` of `user` / `assistant` / `toolResult`. Assistant content blocks are `text`, `thinking`, and `toolCall` (`{name, arguments}`); tool results are `role:"toolResult"` with `toolName` and text content.

   What is it doing right now (last ~30 lines):
   ```bash
   tail -30 "$SESSION" | jq -rc 'select(.type=="message") | .message as $m |
     if $m.role=="assistant" then
       ($m.content[]? | if .type=="toolCall" then "TOOL \(.name): \(.arguments|tojson|.[0:120])"
        elif .type=="text" then "TEXT: \(.text[0:200])" else empty end)
     elif $m.role=="toolResult" then "RESULT(\($m.toolName)): \(([$m.content[]?.text]|join(" "))[0:120])"
     else empty end'
   ```
   Final answer (last non-empty assistant text):
   ```bash
   jq -rs '[.[] | select(.type=="message" and .message.role=="assistant")
     | .message.content[]? | select(.type=="text" and (.text|gsub("^\\s+|\\s+$";"")|length>0)) | .text] | last' "$SESSION"
   ```
   Thinking blocks (`type:"thinking"` in content) reveal reasoning when the model emits them. The `model_change` event near the top records which model actually ran (`provider`/`modelId`) — check it to confirm `--model` took effect.

3. **Raw fallback**: `herdr pane read <pane_id> --source recent-unwrapped` — the rpc event stream on screen (`tool_execution_start`, `message_update` deltas, `turn_end`, `agent_settled`); same data, noisier.

Use mid-turn inspection when a turn runs long, when verifying the agent followed the brief (right files, no forbidden commands), or before deciding to interrupt.

## Gotchas

- **Extension dialogs hang rpc agents.** pi has no built-in tool approval prompts (`--auto-approve` does not exist and isn't needed — built-in tools just run). BUT extensions that call `ctx.ui.select/confirm/input` emit an `extension_ui_request` and block until something answers — in a herdr-driven rpc pane, nothing ever does. Guard extensions (global or project-level — e.g. commit-confirmation, destructive-command guards) will freeze a subagent mid-turn. Instruct every subagent: NEVER run `git commit` or destructive shell commands — the orchestrator handles commits. If a `done` never comes, check the pane tail for `extension_ui_request` and interrupt.
- **Project trust in rpc mode**: non-interactive pi never shows trust prompts and silently ignores untrusted project-local `.pi/` resources (skills, extensions, settings). Since project tooling lives in `.pi/`, always spawn with `--approve` so subagents load it.
- Status lags ~2–5s after sending a prompt — an immediate `agent get` can still show `idle` before flipping to `working`. Verify a prompt landed via the session file tail or pane tail (`turn_start`).
- The session file is created **lazily at the first turn** — `agent_session.value` points to a path that may not exist right after spawn. It appears once the first prompt is processed.
- Subagents start blank — every prompt must be self-contained (paths, context, expected output shape, live-environment facts + exact herdr ids from the survey above).
- `herdr agent send` writes literal text without Enter; the follow-up `pane send-keys enter` is required.
- Multiple agents run fine concurrently; each has its own name, status, and session file.
- Pane/workspace ids compact as things close — address agents by name, re-survey ids before each batch, and close panes/workspaces as work completes.
