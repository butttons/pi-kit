---
name: pr-helper
description: Creates GitHub pull requests from the current branch. Use when the user asks to make a PR, open a PR, or create a pull request.
allowed-tools: Read, Bash(git:*), Bash(gh:*)
---

# Creating Pull Requests

Create GitHub pull requests using the `gh` CLI.

## Instructions

1. Run `git log --oneline main..<current-branch>` to see all commits on the branch.
2. Ensure the branch is pushed: `git push origin <branch>`. If it fails, ask the user.
3. Draft a PR title and body based on the commits.
4. Create the PR with `gh pr create`.

## Title

Short, descriptive. Follow the same conventions as commit messages but can be slightly longer. Examples:

- `v0.0.5: session metadata + query command`
- `fix: resolve stale session detection race condition`
- `feat: add branch tracking across CLI and worker`

If the branch contains a mix of features, use a version or summary label.

## Body

Use this structure:

```markdown
## Summary

One or two sentences describing the overall goal of the PR.

## Changes

Group changes by area/theme with `###` subheadings. Under each, use bullet points. Be concise -- one line per change, describe what not how.

## Tests

One line summarizing test counts and coverage areas. Example:
- CLI: 76 tests across 5 files (11 new)
- Worker: 107 tests across 11 files
```

### Body rules

- No emojis.
- Use `**bold**` for package/component names in bullet points.
- Keep bullet points to one sentence each.
- Do not list every file changed -- summarize by feature.
- Include test summary if tests were added or changed.
- If there is a single commit, the body can be minimal (summary + one bullet list).

## Flags

Always specify `--base main` (or whatever the target branch is). Let `--head` default to the current branch or specify it explicitly.

## Flow

1. Gather commits and draft the title + body.
2. Show the proposed title and body to the user as plain text.
3. If the user approves, push the branch and run `gh pr create`.
4. If the user has feedback, revise and repeat.
5. Output the PR URL after creation.

## Best Practices

- Push before creating the PR so the remote branch exists.
- If the branch is already pushed, do not push again unless there are new commits.
- Use `gh pr create` not the GitHub web UI.
- Pass the body inline with `--body` rather than opening an editor.
