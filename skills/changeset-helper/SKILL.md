---
name: changeset-helper
description: Manage changelogs and versioning using the changesets CLI. Use when creating changesets, bumping versions, consuming changesets for a release, or maintaining CHANGELOG.md files.
---

# changeset-helper

Workflow for projects using [@changesets/cli](https://github.com/changesets/changesets) for versioning and changelog management.

## Detecting Changesets

Check if a project uses changesets:

```bash
ls .changeset/config.json 2>/dev/null
```

If it exists, always use this workflow. Never manually edit `version` fields in `package.json` files.

## Creating a Changeset

After committing a user-facing or notable change, create a changeset file. Use the CLI or write the file directly.

### Via CLI

```bash
pnpm changeset
```

This opens an interactive prompt for package selection and bump type.

### Writing Directly

Create `.changeset/<short-kebab-name>.md`:

```markdown
---
"@scope/package-name": patch
---

One-line description of the change from the user perspective.
```

Multiple packages can be listed if the change spans several:

```markdown
---
"@scope/cli": minor
"@scope/worker": patch
---

Add query command to CLI with new worker endpoint.
```

### Naming Convention

Use short kebab-case that summarizes the change:

- `add-clear-command.md`
- `fix-stale-session.md`
- `presigned-url-upload.md`

### Bump Types

- `patch` -- bug fixes, small improvements. Default for most pre-1.0 changes.
- `minor` -- new features, significant functionality additions.
- `major` -- breaking changes to public API.

### Description Rules

- One sentence.
- User-facing language.
- Present tense.
- No emojis.

Good: `Add residue clear command to remove stuck pending sessions.`
Bad: `Fixed the thing that was broken in the last release.`

### When to Skip

Do not create changesets for:

- CI/pipeline-only changes
- Internal refactors with no behavior change
- Test-only changes
- Comment or AGENTS.md edits

## Consuming Changesets for a Release

When preparing a release, consume all accumulated changesets:

```bash
pnpm changeset version
```

This does three things:
1. Bumps `version` in all affected `package.json` files.
2. Deletes the consumed `.changeset/*.md` files.
3. Updates or creates `CHANGELOG.md` files in each package.

After running, review the changes and commit:

```bash
git add -A
git commit -m "chore: version packages"
```

### Fixed Version Groups

Some monorepos use fixed version groups (configured in `.changeset/config.json`). All packages in the group share the same version. A changeset for any single package bumps them all.

Check the config:

```bash
cat .changeset/config.json | grep -A5 fixed
```

### Root CHANGELOG.md

Some projects maintain a root `CHANGELOG.md` manually in addition to per-package changelogs. If the project has one, update it when releasing. Format:

```markdown
## X.Y.Z

### @scope/cli

- Description of change one
- Description of change two

### @scope/worker

- Description of change
```

Newest version at the top. Only include packages that had changes.

## Full Release Flow

1. Accumulate changesets on the feature/release branch (one per notable commit).
2. Run `pnpm changeset version` to bump versions and consume changesets.
3. Update root `CHANGELOG.md` if the project has one.
4. Commit the version bump and changelog together.
5. Tag and release (see the release-helper skill).

## Rules

- Never manually edit `version` in `package.json` when changesets are configured.
- Always use `pnpm changeset version` to bump -- it handles fixed groups and changelog generation.
- Create changesets promptly after each meaningful commit, not all at once before release.
- Check `.changeset/config.json` for project-specific configuration before assuming defaults.
