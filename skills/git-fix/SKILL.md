---
name: git-fix
description: Diagnose and fix diverged git branches. Use when local and remote have diverged, or when the user says git is messed up.
allowed-tools: Bash(git:*), AskUserQuestion, Read
---

# Fix Diverged Git Branches

Diagnose and resolve situations where local and remote branches have diverged, have conflicts, or are otherwise out of sync.

## Instructions

### 1. Diagnose the current state

Run these commands to understand the situation:

```
git status
git log --oneline -10
git log --oneline origin/<branch> -5
```

Check for:
- Diverged branches (`have diverged, and have X and Y different commits each`)
- Ahead/behind status
- Uncommitted changes or untracked files that might block operations
- Detached HEAD state
- In-progress rebase/merge/cherry-pick

### 2. Identify the divergence

```
git log --oneline origin/<branch>..HEAD    # local-only commits
git log --oneline HEAD..origin/<branch>    # remote-only commits
```

Summarize what each side has to the user: commit hashes, short messages, and count.

### 3. Present resolution options

Use `AskUserQuestion` to let the user choose. Always present these options (adapt wording to context):

- **Rebase on remote (Recommended)** -- replay local commits on top of remote. Clean linear history. May require conflict resolution.
- **Drop local commits** -- hard reset to remote, discarding local work entirely.
- **Merge** -- merge remote into local, creating a merge commit.

If the situation is simpler (e.g. just behind, or just ahead), skip the question and explain what's needed.

### 4. Execute the chosen strategy

#### Rebase

1. Check for untracked files that would block checkout. If found, move them to `/tmp/` temporarily.
2. Run `git rebase origin/<branch>`.
3. If conflicts arise:
   - Read each conflicted file to understand both sides.
   - Resolve conflicts by understanding what each side intended. Prefer keeping both sides' intent when possible.
   - Stage resolved files with `git add`.
   - Build the project if a build command is available (check CLAUDE.md) to verify resolution.
   - Run `git rebase --continue`.
4. Verify clean state with `git status` and `git log --oneline -5`.
5. Restore any temporarily moved files from `/tmp/`.

#### Drop local

1. Confirm with the user one more time -- this is destructive.
2. Run `git reset --hard origin/<branch>`.
3. Verify with `git status`.

#### Merge

1. Run `git merge origin/<branch>`.
2. Resolve conflicts if any (same process as rebase conflicts).
3. Verify with `git status` and `git log --oneline -5`.

### 5. Report the result

Show the final `git log --oneline -5` and `git status` output. Summarize:
- How many commits are ahead/behind remote
- Whether the working tree is clean
- Any files that were restored from `/tmp/`

## Important rules

- NEVER force push without explicit user approval.
- NEVER drop commits without explicit user approval.
- NEVER use `--no-verify` or skip hooks.
- NEVER amend commits that have already been pushed.
- If unsure about anything, ask the user before proceeding.
- Always build/verify after conflict resolution when possible.
- When resolving conflicts, read both versions carefully -- don't blindly pick one side.
