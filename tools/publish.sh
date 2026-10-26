#!/bin/zsh
# Encrypt the latest board export and push it to the website.
# Export: ~/.wf-board/x (written by the sync task). State: ~/.wf-board/state.
set -euo pipefail
WF="$HOME/.wf-board"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
node "$REPO/tools/build.mjs" --export "$WF/x" --site "$REPO" --state "$WF/state"
cd "$REPO"
git add data.enc.json
git commit -q -m "Update board data" || { echo "No change to publish."; exit 0; }
git push -q
echo "Published."
