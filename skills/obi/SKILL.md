---
name: obi
description: Query Obsidian vaults via obi CLI. Use for any vault data lookup instead of grep or find -- searching notes, filtering by frontmatter (read status, type, tags), listing folders, reading sections, checking backlinks, and finding unread or recent notes.
---

# Obsidian Vault Lookup

Read-only reference for querying Obsidian vaults from the terminal using `obi` (installed globally via `@butttons/obi`). All output is TOON by default. Add `--json` for structured JSON.

## Orientation

Before doing anything, orient yourself in the vault.

### Discover available vaults

```bash
obi vaults
```

Returns vault names, paths, and note counts. Use this to pick the right `--vault` value.

### Vault structure

```bash
obi map --vault "VaultName"
```

Returns all folders (with file counts) and all files (with title, type from frontmatter). This is the single best command to understand what a vault contains. Start here.

### Property schema and taxonomy

```bash
obi schema --vault "VaultName"
```

Returns all frontmatter property definitions, all `type` values in use (e.g. worker, client, package, tool), and all tags in use (e.g. billing, auth, deals). Use this to know what filters are available before running `query`.

### Current workspace state

```bash
obi context --vault "VaultName"
```

Returns the active file in Obsidian, recently opened files, last search term, and open tabs. Useful to understand what the user was last working on.

## Reading Notes

### Full note

```bash
obi read "path/to/note.md" --vault "VaultName"
```

Returns frontmatter (parsed), body (markdown), outgoing wiki-links, and incoming backlinks. Paths are relative to vault root.

### Specific section

```bash
obi read "path/to/note.md" -s "Section Heading" --vault "VaultName"
```

Extracts content under the given heading, stopping at the next heading of equal or higher level. Use this when you only need one part of a long note.

### Heading structure

```bash
obi toc "path/to/note.md" --vault "VaultName"
```

Returns the heading tree with levels and line numbers. Use this to discover what sections exist before extracting one with `read -s`.

### Link graph

```bash
obi links "path/to/note.md" --vault "VaultName"
```

Returns outgoing links, incoming backlinks, and two-hop connections (notes linked from notes that link to this one). Two-hop connections are useful for discovering related context the user might not have mentioned.

## Browsing

### Folder contents

```bash
obi list "folder" --vault "VaultName"
```

Returns files in a folder with title, type, and tags from frontmatter. Omit the folder argument to list the vault root.

```bash
obi list --vault "VaultName"
```

## Querying

### Filter by frontmatter fields

```bash
# By type
obi query --type worker --vault "VaultName"

# By tag
obi query --tag billing --vault "VaultName"

# Compound (AND logic)
obi query --type worker --tag deals --vault "VaultName"

# Generic frontmatter filter (any key=value)
obi query -f "status=active" --vault "VaultName"
obi query -f "read=false" --vault "VaultName"
```

Returns matching notes with their full frontmatter. Compound filters use AND logic -- all conditions must match.

Always run `obi schema` first to know what types and tags exist before filtering.

### Content search

```bash
obi search "search term" --vault "VaultName"
```

Returns file path, line number, and matching line text for every hit. Use this for free-text search across all notes.

### Recently updated

```bash
obi recent --vault "VaultName"
obi recent --limit 5 --vault "VaultName"
```

Returns notes sorted by `updated_at` from frontmatter. Use `--limit` to cap results.

### Unread notes

```bash
obi unread --vault "VaultName"
```

Returns notes where `read: false` in frontmatter. Empty result if the vault does not use a `read` field.

## JSON Output

Add `--json` to any command for machine-readable output:

```bash
obi map --vault "VaultName" --json
obi read "path/to/note.md" --vault "VaultName" --json
```

Use `--json` when you need to pipe output or parse specific fields programmatically.

## Common Patterns

### Find which doc covers a topic

```bash
obi search "topic keyword" --vault "VaultName"
```

Then read the matched note:

```bash
obi read "matched/note.md" --vault "VaultName"
```

### Understand a component and its dependencies

```bash
obi read "path/to/component.md" --vault "VaultName"
```

Check the outgoing links in the response -- those are the dependencies. Then follow them:

```bash
obi read "dependency/note.md" --vault "VaultName"
```

For broader context, use links to see two-hop connections:

```bash
obi links "path/to/component.md" --vault "VaultName"
```

### Get a project overview

Most vaults have an `index.md` at the root:

```bash
obi read "index.md" --vault "VaultName"
```

If not, use `map` to see the full structure and `list` to browse from there.

### Discover all components of a type

```bash
obi schema --vault "VaultName"   # see what types exist
obi query --type worker --vault "VaultName"   # get all of that type
```

### Find everything related to a tag

```bash
obi schema --vault "VaultName"   # see what tags exist
obi query --tag billing --vault "VaultName"   # get all notes with that tag
```

### Read a specific section from a long doc

```bash
obi toc "path/to/note.md" --vault "VaultName"   # see heading structure
obi read "path/to/note.md" -s "Bindings" --vault "VaultName"   # extract just that section
```

### Check what the user was working on

```bash
obi context --vault "VaultName"
```

The `active_file` and `recent_files` fields tell you what the user last had open in Obsidian.

### Cross-vault discovery

```bash
obi vaults   # list all vaults
obi search "term" --vault "Vault1"
obi search "term" --vault "Vault2"
```

There is no single cross-vault search command. Search each vault individually.

## Vault Flag

`--vault` accepts a vault name (e.g. `Work`, `Zomunk`). If omitted:

1. If cwd is inside a vault, obi uses that vault automatically.
2. Otherwise it checks for `default_vault` in global config.
3. Otherwise it errors, listing available vaults.

When unsure which vault to use, run `obi vaults` first.

## Limitations

- Read-only. obi never writes to vault files or `.obsidian/`.
- No cross-vault search in a single command. Search each vault separately.
- Notes without frontmatter still appear in `map` and `list` but with null title/type.
- The `unread` command only works if notes have a `read` boolean field in frontmatter.
- `recent` relies on `updated_at` in frontmatter. Notes without it won't appear.
