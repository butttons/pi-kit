---
name: obsidian
description: Look up documentation in Obsidian vaults using notesmd-cli and grep. Use when the user asks to check docs, look something up, find a note, or reference project documentation.
---

# Obsidian Vault Lookup

Read-only reference for querying Obsidian vaults from the terminal. Uses `notesmd-cli` for structured reads and `grep` for content search.

## Vault Location

All vaults live under:

```bash
OBSIDIAN_BASE="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents"
```

List available vaults:

```bash
ls "$OBSIDIAN_BASE"
```

Check the default vault:

```bash
notesmd-cli print-default
```

## Reading

### Print a full note

```bash
notesmd-cli print "path/to/note"
notesmd-cli print "path/to/note" --vault "VaultName"
```

No `.md` extension needed. Path is relative to vault root.

### Read frontmatter only

```bash
notesmd-cli frontmatter "path/to/note" --print
notesmd-cli frontmatter "path/to/note" --print --vault "VaultName"
```

Output is alphabetically sorted YAML.

### List vault contents

```bash
# Vault root
notesmd-cli list
notesmd-cli list --vault "VaultName"

# A subfolder
notesmd-cli list "subfolder"
notesmd-cli list "subfolder" --vault "VaultName"
```

### Read a specific section

Extract content under a heading:

```bash
notesmd-cli print "path/to/note" | sed -n '/^## Section Name/,/^## /p' | head -n -1
```

For h3 sections:

```bash
notesmd-cli print "path/to/note" | sed -n '/^### Subsection/,/^### /p' | head -n -1
```

## Searching

`notesmd-cli search` and `search-content` are interactive (fzf) and cannot be used by an LLM. Use `grep` for all search operations.

Always resolve the vault path first:

```bash
VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/VaultName"
```

### Search by content

With file and line number:

```bash
grep -rn "search term" "$VAULT" --include="*.md" | grep -v ".pi/" | sed "s|$VAULT/||"
```

File list only:

```bash
grep -rl "search term" "$VAULT" --include="*.md" | grep -v ".pi/" | sed "s|$VAULT/||" | sort
```

### Search by frontmatter field

```bash
# By type
grep -rl "^type: worker" "$VAULT" --include="*.md" | sed "s|$VAULT/||" | sort

# By status
grep -rl "^status: active" "$VAULT" --include="*.md" | sed "s|$VAULT/||" | sort

# By tag (inline array format: tags: [foo, bar])
grep -rl "^tags:.*billing" "$VAULT" --include="*.md" | sed "s|$VAULT/||" | sort

# By any boolean property
grep -rl "^read: false" "$VAULT" --include="*.md" | grep -v ".pi/" | sed "s|$VAULT/||" | sort
```

### Find wiki-links to a specific note

```bash
grep -rn "\[\[path/to/note\]\]" "$VAULT" --include="*.md" | grep -v ".pi/" | sed "s|$VAULT/||"
```

### Find all wiki-links in a note

```bash
grep -oh '\[\[[^]]*\]\]' "$VAULT/path/to/note.md"
```

### Search within a folder

```bash
grep -rn "search term" "$VAULT/subfolder" --include="*.md" | sed "s|$VAULT/||"
```

## Common Patterns

### Find which doc covers a topic

```bash
grep -rln "topic keyword" "$VAULT" --include="*.md" | grep -v ".pi/" | sed "s|$VAULT/||"
```

Then read the matched doc:

```bash
notesmd-cli print "matched/note" --vault "VaultName"
```

### Get a project overview

Most vaults have an `index.md` at the root:

```bash
notesmd-cli print "index" --vault "VaultName"
```

### List all docs of a type

```bash
grep -rl "^type: tool" "$VAULT" --include="*.md" | sed "s|$VAULT/||" | sort
```

### Check what tags exist

```bash
grep -rh "^tags:" "$VAULT" --include="*.md" | grep -v ".pi/" | sort -u
```

### Read a table from a doc

Tables render as pipe-delimited text. Search for the heading above the table:

```bash
notesmd-cli print "path/to/note" --vault "VaultName" | sed -n '/^## Key Services/,/^## /p' | head -n -1
```

### Cross-vault search

Search across all vaults:

```bash
OBSIDIAN_BASE="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents"
grep -rn "search term" "$OBSIDIAN_BASE" --include="*.md" | grep -v ".pi/" | grep -v ".obsidian/" | sed "s|$OBSIDIAN_BASE/||"
```

## Limitations

- `search` and `search-content` are interactive (fzf). Cannot be used non-interactively.
- `open` launches Obsidian GUI. Use `print` to read content.
- `frontmatter --print` outputs fields in alphabetical order, not file order.
- No built-in way to query across multiple frontmatter fields. Combine `grep` pipes for complex queries.
- Vault paths contain spaces (`Mobile Documents`, `iCloud~md~obsidian`). Always quote paths or use variables.
