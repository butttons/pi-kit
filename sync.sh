#!/bin/bash
# Sync pi-kit resources to ~/.pi/agent/
# Run this after pulling changes or editing files locally.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/.pi/agent"

# Extensions
if [ -d "$SCRIPT_DIR/extensions" ]; then
  rsync -a --delete "$SCRIPT_DIR/extensions/" "$TARGET/extensions/"
  echo "Synced extensions"
fi

# Skills
if [ -d "$SCRIPT_DIR/skills" ]; then
  rsync -a --delete "$SCRIPT_DIR/skills/" "$TARGET/skills/"
  echo "Synced skills"
fi

# Prompts
if [ -d "$SCRIPT_DIR/prompts" ]; then
  rsync -a --delete "$SCRIPT_DIR/prompts/" "$TARGET/prompts/"
  echo "Synced prompts"
fi

# Themes
if [ -d "$SCRIPT_DIR/themes" ]; then
  rsync -a --delete "$SCRIPT_DIR/themes/" "$TARGET/themes/"
  echo "Synced themes"
fi

echo "Done. Run /reload in pi to pick up changes."
