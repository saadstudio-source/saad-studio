#!/usr/bin/env bash
# Install the Saad Studio skill pack for Claude Code.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/saadstudio-source/saad-studio/main/packages/skills/install.sh | bash
#
# Copies the skill markdown files into ~/.claude/skills/ so Claude Code
# picks them up automatically. Existing files with the same names are
# overwritten so re-running upgrades the pack.

set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/saadstudio-source/saad-studio/main/packages/skills/skills"
SKILLS=(
  "saadstudio-image.md"
  "saadstudio-video.md"
  "saadstudio-ugc-video.md"
  "saadstudio-storyboard.md"
)

TARGET_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
mkdir -p "$TARGET_DIR"

echo "Installing Saad Studio skills into $TARGET_DIR"

for skill in "${SKILLS[@]}"; do
  echo "  - $skill"
  curl -fsSL "$REPO_RAW/$skill" -o "$TARGET_DIR/$skill"
done

echo ""
echo "Done. Reload Claude Code to pick up the new skills."
echo ""
echo "Next steps:"
echo "  1. npm i -g @saadstudio/cli   # if you haven't"
echo "  2. saadstudio login           # authorize once"
echo "  3. Ask Claude Code: 'generate a UGC-style ad for <product>'"
