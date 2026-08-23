# pi-kit

Personal [pi](https://pi.dev) extensions, pi-specific skills, and themes.

Universal, harness-agnostic skills (git workflows, obi, playwright-cli, dora, exe-dev, ...) live in [agents.dotfiles](https://github.com/butttons/agents.dotfiles) and are loaded directly by every harness — they are no longer part of this package. pi-kit keeps only what is pi-specific (`herdr-pi-subagents`, `pi-costs`).

## Install

```bash
pi install git:github.com/butttons/pi-kit
```

Cherry-pick resources via the `packages` array in `~/.pi/agent/settings.json` (or `.pi/settings.json` for project-level); after install, `pi config` toggles individual resources from the TUI.

## What's inside

No inventory tables here — they drift. Look at the filesystem; every extension and skill documents itself in its own file:

```bash
ls extensions/ skills/ themes/
head -20 extensions/safe-delete.ts     # each file explains itself at the top
head -5 skills/pi-costs/SKILL.md       # name + description from frontmatter
```
