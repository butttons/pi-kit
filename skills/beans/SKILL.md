---
name: beans
description: Manage tasks, bugs, and features with the beans issue tracker. Use when creating, listing, updating, or working on beans, or when the user asks what to work on next.
allowed-tools: Read, Bash(beans:*,git:*)
---

# Beans Issue Tracker

[Beans](https://github.com/hmans/beans) stores issues as markdown files in `.beans/`. Config in `.beans.yml`.

## Before Starting Any Task

1. Check for an existing bean: `beans list --json --ready`
2. If none exists, create one: `beans create "Title" -t <type> -d "Description" -s in-progress`
3. If one exists, set it in-progress: `beans update <id> -s in-progress`

## During Work

- Check off todo items as they complete: `beans update <id> --body-replace-old "- [ ] Task" --body-replace-new "- [x] Task"`
- Include `.beans/` files in commits alongside code changes

## After Completing

- Add a summary: `beans update <id> --body-append "## Summary of Changes\n\nWhat was done."`
- Mark completed: `beans update <id> -s completed`
- Offer to create follow-up beans for deferred work

## Key Commands

```bash
# List and find
beans list                              # All beans (tree view)
beans list --json --ready               # Ready to start (not blocked, not done)
beans list --json -t bug -s todo        # Filter by type and status
beans list --json -S "search term"      # Full-text search

# View
beans show <id>                         # Single bean
beans show --json <id> [id...]          # Multiple beans, machine-readable

# Create (always specify -t type)
beans create "Title" -t task -d "Description" -s todo
beans create "Title" -t bug -p high -d "Description"

# Update
beans update <id> -s in-progress
beans update <id> --parent <other-id>
beans update <id> --blocked-by <other-id>
beans update <id> --blocking <other-id>

# Body modifications
beans update <id> --body-replace-old "old text" --body-replace-new "new text"
beans update <id> --body-append "New content"

# Archive completed/scrapped beans (only when user requests)
beans archive
```

## Types

- **milestone**: Target release or checkpoint
- **epic**: Thematic container for related work (should have children, not be worked on directly)
- **feature**: User-facing capability
- **task**: Concrete piece of work
- **bug**: Something broken

## Statuses

`draft` | `todo` | `in-progress` | `completed` | `scrapped`

## Priorities

`critical` | `high` | `normal` | `low` | `deferred`

## Relationships

- `--parent <id>`: Hierarchy (milestone > epic > feature > task)
- `--blocked-by <id>`: This bean can't start until the other is done
- `--blocking <id>`: This bean blocks the other

## GraphQL (Advanced)

```bash
# Multiple replacements in one call
beans query 'mutation {
  updateBean(id: "<id>", input: {
    status: "completed"
    bodyMod: {
      replace: [
        { old: "- [ ] Task 1", new: "- [x] Task 1" }
        { old: "- [ ] Task 2", new: "- [x] Task 2" }
      ]
      append: "## Summary\n\nDone."
    }
  }) { id body etag }
}'

# Query with filters
beans query --json '{ beans(filter: { type: ["bug"], priority: ["critical","high"] }) { id title status } }'
```

## Commit Convention

When committing work tracked by a bean, include the bean ID in the commit footer:

```
feat(trips): implement flag route endpoint

Refs: zmk-nbbf
```
