#!/bin/zsh
# Install (or reinstall) the Mac publish job. Run once on John's Mac.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/LaunchAgents/com.wfboard.publish.plist"
chmod +x "$REPO/tools/mac-publish.sh" "$REPO/tools/publish.sh"
mkdir -p "$HOME/Library/LaunchAgents"
sed "s#__HOME__#$HOME#g" "$REPO/tools/com.wfboard.publish.plist" > "$DEST"
launchctl bootout "gui/$(id -u)/com.wfboard.publish" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "Installed. The Mac now publishes the board within 10 minutes of each sync."
echo "Log: ~/.wf-board/state/publish.log"
