---
name: release-helper
description: Automates git tag creation and GitHub release workflow. Use when creating releases or version tags.
allowed-tools: Read, Bash(git:*, gh:*)
---

# Creating Releases

Automate git tag creation and GitHub releases with user oversight.

## Tag Naming Formats

Support multiple versioning strategies:

- **Semantic Versioning**: v0.0.2, v0.1.0, v1.0.0
- **Date-based**: v2026-01-19, 2026.01.19
- **Custom**: User-provided format

## Release Notes Structure

Group commits by [Conventional Commits](https://www.conventionalcommits.org/) type:

```markdown
## Features

- feat(scope): description

## Bug Fixes

- fix(scope): description

## Documentation

- docs: description
```

## Instructions

1. **Check git status** to verify working directory is clean
2. **Verify gh CLI** is installed (`gh --version`)
3. **Check current branch** and warn if not on main/master
4. **Check for changesets** (`ls .changeset/config.json`). If present, follow the Changesets Integration section below for versioning and changelog generation before proceeding to tagging.
5. **Get commit history** since last tag (or all commits if no tags exist)
6. **Parse commits** and group by type (feat, fix, docs, etc.)
7. **Suggest tag name** based on package.json version or date
8. **Generate release notes** in markdown format. Keep them concise and high-level. Summarize what the release contains rather than dumping the commit log.
9. **Show proposed tag and notes** to user
10. **Ask for tag format** using `AskUserQuestion` with options:
    - Semantic version (suggest next version from package.json)
    - Date-based (today's date)
    - Custom (user provides)
11. **Ask for approval** using `AskUserQuestion` with proposed tag name and release notes
12. **If approved**:
    - `git tag -a <tag> -m "<release notes>"`
    - `git push origin <tag>`
    - `gh release create <tag> --notes "<release notes>"`
13. **If not approved**, ask what to change and regenerate

## Pre-flight Checks

Before proceeding, verify:

- Working directory is clean (`git status --porcelain` returns empty)
- On main/master branch (or ask user to confirm if not)
- Tag doesn't already exist (`git tag -l "<tag>"` returns empty)
- gh CLI is installed and authenticated

If any check fails, inform user and abort.

## Release Notes Generation

Parse commit messages and extract:

- **Type**: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- **Scope**: optional scope in parentheses
- **Description**: commit message after type/scope
- **Breaking changes**: commits with ! or BREAKING CHANGE footer

Group by type and format as markdown list. Omit empty sections.

## Example Workflow

```bash
# 1. Check status
git status --porcelain

# 2. Check if gh is installed
gh --version

# 3. Get last tag
git describe --tags --abbrev=0 2>/dev/null || echo "No tags found"

# 4. Get commits since last tag (or all if none)
git log <last-tag>..HEAD --oneline
# OR if no tags:
git log --oneline

# 5. Parse commits and generate release notes
# Group by type, format as markdown

# 6. Ask user for tag format
AskUserQuestion: "What version format do you want?"
Options:
- v0.0.2 (next semantic version)
- v2026-01-19 (today\'s date)
- Custom

# 7. Show proposed release
Tag: v0.0.2

Release Notes:
## Features
- feat(showcase): add new project
- feat(ui): improve mobile layout

## Bug Fixes
- fix: correct typo in footer

## Documentation
- docs: update README

# 8. Ask for approval
AskUserQuestion: "Create this release?"
Options:
- Yes, create release
- No, let me edit the notes
- Cancel

# 9. If approved, create release
git tag -a v0.0.2 -m "Release notes here"
git push origin v0.0.2
gh release create v0.0.2 --notes "Release notes here"
```

## Changesets Integration

If `.changeset/config.json` exists, the project uses `@changesets/cli` for versioning and changelog management. Integrate it into the release flow:

### Detection

```bash
# Check if changesets is configured
test -f .changeset/config.json && echo "changesets detected"

# Check for pending changesets (any .md files besides README.md)
ls .changeset/*.md 2>/dev/null | grep -v README.md
```

### Pre-release: consume pending changesets

If there are pending changeset files, version the packages before tagging:

```bash
# This bumps versions in package.json files, updates CHANGELOG.md files,
# and removes the consumed changeset .md files
pnpm changeset version
```

Review the version bumps and changelog updates, then commit them before creating the tag.

### Post-release: verify clean state

After `changeset version` runs, only `config.json` and `README.md` should remain in `.changeset/`. If changeset files are still present, something went wrong.

### When no pending changesets exist

If there are no pending changeset `.md` files, the versions have already been bumped (e.g., `changeset version` was run manually earlier). Proceed directly to tagging using the version from `package.json`.

### Workflow with changesets

1. Check for pending changesets
2. If pending: run `pnpm changeset version`, review changes, commit
3. Read version from package.json to determine tag name
4. Proceed with normal tag + release flow

## Best Practices

- Always verify working directory is clean before tagging
- Use annotated tags (`-a`) not lightweight tags
- Include release notes in tag message
- Push tag before creating GitHub release
- Use same notes for both tag and GitHub release
- Keep release notes concise and high-level. Summarize what changed, do not dump the commit log.
- Include breaking changes prominently if any exist
- If the project has changelogs managed by changesets, use them as the source of truth for release notes

## Error Handling

If errors occur:

- **Dirty working directory**: Inform user and suggest `git status`
- **gh not installed**: Provide installation instructions
- **Tag already exists**: List existing tags and suggest different name
- **Not on main branch**: Ask user to confirm or switch branches
- **gh authentication failed**: Suggest `gh auth login`
- **Network errors**: Inform user and suggest retry

IMPORTANT: Always use `AskUserQuestion` for user approval. Never create tags or releases without explicit user confirmation.
