# pi-kit

Personal extensions, skills, and themes for [pi](https://pi.dev).

## Setup

Clone the repo and run the sync script:

```bash
git clone git@github.com:butttons/pi-kit.git
cd pi-kit
./sync.sh
```

This copies everything into `~/.pi/agent/`. Run `/reload` in pi to pick up changes.

## Structure

```
extensions/         Global extensions
  context-usage.ts    Custom footer with model, tokens, cost, context bar
  dora.ts             Dora code intelligence lifecycle hooks
  handoff.ts          /handoff command to transfer context to a new session
  plan-mode/          /plan read-only exploration mode with progress tracking
  safe-commit.ts      Confirm before git commits
  safe-delete.ts      Confirm before large file deletions
  shell-preprocessor.ts  Expand $`command` in prompts

skills/             Global skills
  cloudflare-api/     Cloudflare developer documentation index
  commit-helper/      Conventional commit message generation
  git-fix/            Diagnose and fix diverged git branches
  playwright-cli/     Browser automation via playwright-cli
  pr-helper/          GitHub pull request creation
  release-helper/     Git tag and GitHub release workflow

themes/
  butttons.json       Catppuccin Mocha-based theme
```

## Workflow

Edit files locally, then sync:

```bash
./sync.sh
```

Commit and push to keep the repo up to date:

```bash
git add -A && git commit -m "description" && git push
```

On a new machine, clone and run `./sync.sh`.
