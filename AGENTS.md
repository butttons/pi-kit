# AGENTS.md

This is a pi package (`pi install git:github.com/butttons/pi-kit`). It contains extensions, skills, and themes.

Read `README.md` and `package.json` before making changes. Follow the conventions already present in existing extensions and skills.

After every change to extensions, skills, or themes, bump the `version` in `package.json` before committing. Use semver: patch for fixes and tweaks, minor for new features or removals, major for breaking changes. After pushing, create a GitHub release with `gh release create vX.Y.Z --generate-notes`.

## Testing changes locally

To test an extension or skill change without committing, copy the changed file to `~/.pi/agent/git/github.com/butttons/pi-kit/` (mirroring the same relative path) and run `/reload` in the active pi session.

## Updating the installed package

The installed package lives at `~/.pi/agent/git/github.com/butttons/pi-kit` with its remote pointing to this repo. After pushing changes here, run `git pull` in that directory to update the agent's copy.
