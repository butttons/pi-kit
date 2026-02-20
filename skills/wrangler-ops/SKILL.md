---
name: wrangler-ops
description: Operational patterns for Cloudflare Wrangler CLI. Use when deploying workers, running D1 migrations, querying D1 databases, managing R2 buckets, or generating binding types. Distinct from cloudflare-api which covers documentation lookups.
---

# wrangler-ops

Conventions and commands for working with the Cloudflare Wrangler CLI in projects.

## Local Wrangler Config

Many projects have a gitignored local wrangler config (commonly `wrangler.local.jsonc` or `wrangler.local.toml`) that contains real account IDs, D1 database IDs, R2 bucket names, and worker names. The committed `wrangler.jsonc` has stub/placeholder values for distribution.

Always check for a local config first:

```bash
ls wrangler.local.* 2>/dev/null
```

If one exists, always pass it with `-c`:

```bash
pnpm exec wrangler deploy -c wrangler.local.jsonc
pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.local.jsonc
```

Never modify or commit the local config. Never read `.dev.vars` -- it contains secrets.

## Deploying

```bash
# Always use local config if it exists
pnpm exec wrangler deploy -c wrangler.local.jsonc

# Without local config
pnpm exec wrangler deploy
```

Deploy scripts are usually defined in `package.json`. Prefer those when available.

## D1 Database Operations

### Migrations

```bash
# Apply migrations to remote database
pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.local.jsonc

# Apply to local (dev) database
pnpm exec wrangler d1 migrations apply DB --local

# Create a new migration
pnpm exec wrangler d1 migrations create DB "add_users_table"
```

The `DB` above is the binding name defined in the wrangler config, not the database name.

### Querying

```bash
# Query remote D1
pnpm exec wrangler d1 execute DB --remote -c wrangler.local.jsonc \
  --command "SELECT COUNT(*) FROM users"

# Query local D1
pnpm exec wrangler d1 execute DB --local \
  --command "SELECT name FROM sqlite_master WHERE type='table'"

# Check migration state
pnpm exec wrangler d1 execute DB --remote -c wrangler.local.jsonc \
  --command "SELECT * FROM d1_migrations"

# Inspect table schema
pnpm exec wrangler d1 execute DB --remote -c wrangler.local.jsonc \
  --command "PRAGMA table_info(users)"
```

## Generating Binding Types

After changing `wrangler.jsonc` or `.dev.vars`, regenerate types:

```bash
pnpm exec wrangler types
```

This produces a `worker-configuration.d.ts` (or similar) that should be gitignored and excluded from linters/formatters like biome.

## R2 Operations

```bash
# List buckets
pnpm exec wrangler r2 bucket list

# List objects in a bucket
pnpm exec wrangler r2 object list my-bucket

# Download an object
pnpm exec wrangler r2 object get my-bucket/path/to/file.json

# Upload an object
pnpm exec wrangler r2 object put my-bucket/path/to/file.json --file ./local-file.json
```

## Dev Server

```bash
# Start dev server (uses local D1 by default)
pnpm exec wrangler dev

# With local config
pnpm exec wrangler dev -c wrangler.local.jsonc

# Dev server using remote D1 (useful for testing with real data)
pnpm exec wrangler dev --remote -c wrangler.local.jsonc
```

The dev server is usually started via tmux panes, not inline.

## Common Issues

### Migration schema mismatch

If `d1_migrations` is empty but tables exist (from one-click deploy or manual creation), backfill migration records for already-applied migrations before running new ones:

```bash
pnpm exec wrangler d1 execute DB --remote -c wrangler.local.jsonc \
  --command "INSERT INTO d1_migrations (id, name, applied_at) VALUES (1, '0001_init.sql', datetime('now'))"
```

Then apply remaining migrations normally.

### Worker not reflecting changes

Redeploy after migration changes. Migrations update the database schema, but the worker code must also be redeployed if it references new columns.

## Rules

- Always check for `wrangler.local.*` before running any wrangler command against remote resources.
- Never read or output `.dev.vars` contents.
- Never modify the committed `wrangler.jsonc` unless the user explicitly asks.
- Use `pnpm exec wrangler` (or `npx wrangler`) rather than a global install.
- Run dev servers in tmux, not inline.
