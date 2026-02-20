---
name: tmux-helper
description: Interact with tmux sessions, windows, and panes. Use when the user mentions tmux, dev servers, checking logs in panes, restarting services, or running commands in background terminals. Also covers tmuxinator for session management.
---

# tmux-helper

Reference for interacting with tmux from within an agent session.

## Reading Pane Output

Always use `capture-pane` to read what is currently visible in a pane:

```bash
# Capture visible output from a specific pane (target format: session:window.pane)
tmux capture-pane -t 0:1.0 -p

# Capture with scrollback (last 100 lines)
tmux capture-pane -t 0:1.0 -p -S -100

# Capture all scrollback
tmux capture-pane -t 0:1.0 -p -S -
```

The `-p` flag prints to stdout instead of a buffer. Without it nothing is returned.

## Listing State

```bash
# List all sessions
tmux list-sessions

# List windows in current session
tmux list-windows

# List windows in a specific session
tmux list-windows -t mysession

# List all panes in a window (shows pane index, dimensions, command)
tmux list-panes -t mysession:1

# List all panes across all sessions with details
tmux list-panes -a -F "#{session_name}:#{window_index}.#{pane_index} #{pane_current_command} #{pane_width}x#{pane_height}"
```

## Sending Commands to Panes

```bash
# Send a command to a pane (C-m is Enter)
tmux send-keys -t 0:1.0 "npm run dev" C-m

# Send Ctrl+C to stop a process
tmux send-keys -t 0:1.0 C-c

# Send Ctrl+C then a new command (restart a server)
tmux send-keys -t 0:1.0 C-c && sleep 0.5 && tmux send-keys -t 0:1.0 "npm run dev" C-m
```

## Managing Panes and Windows

```bash
# Kill a specific pane
tmux kill-pane -t 0:1.2

# Kill a full window (all panes in it)
tmux kill-window -t 0:1

# Split current window horizontally (top/bottom)
tmux split-window -t 0:1 -v

# Split vertically (left/right)
tmux split-window -t 0:1 -h

# Create a new window
tmux new-window -t mysession

# Rename a window
tmux rename-window -t 0:1 "workers"
```

## Target Format

The `-t` target format is `session:window.pane`. Parts are optional:

- `0` -- session 0, current window, current pane
- `0:1` -- session 0, window 1, current pane
- `0:1.2` -- session 0, window 1, pane 2
- `mysession:workers` -- named session and named window

## tmuxinator

The user uses tmuxinator for project-specific layouts. Config files live in either `~/.tmuxinator/` or `.tmuxinator/` in the project root.

```bash
# Start a tmuxinator project from a file
tmuxinator start -p .tmuxinator/web.yml

# Start a named project from ~/.tmuxinator/
tmuxinator start web

# Stop a project (kills the tmux session)
tmuxinator stop web

# List available projects
tmuxinator list
```

## Common Patterns

### Restart a dev server in a pane

```bash
tmux send-keys -t 0:1.0 C-c
sleep 0.5
tmux send-keys -t 0:1.0 "pnpm dev" C-m
```

### Check if a server is running

```bash
tmux capture-pane -t 0:1.0 -p -S -20
```

Look for "listening on" or error output in the captured text.

### Run a command without disturbing the pane

If the pane has an idle shell, send the command. If a process is running, either use a different pane or kill the process first.

## Rules

- Never use `nohup` or background processes. tmux panes are the designated way to run long-lived processes.
- Always confirm which pane has which server before sending commands. Use `list-panes` first.
- When the user says "check tmux" or "see tmux", capture pane output and report what you see.
- When the user says "run in tmux", send the command to an appropriate idle pane.
