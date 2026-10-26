#!/bin/zsh
# Runs on the Mac itself (launch agent every 10 minutes), never in the Claude sandbox.
# The sync task in the sandbox leaves a fresh board export in ~/.wf-board/x and writes x/.ready last.
# When .ready is newer than the last publish, encrypt (password from the Keychain) and push (GitHub sign-in).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
WF="$HOME/.wf-board"
READY="$WF/x/.ready"
LAST="$WF/state/last-published"
LOG="$WF/state/publish.log"

[ -f "$READY" ] || exit 0
[ -f "$LAST" ] && [ ! "$READY" -nt "$LAST" ] && exit 0

{
  echo "$(date '+%m/%d %I:%M %p') fresh export found, publishing"
  if "$WF/repo/tools/publish.sh"; then
    touch -r "$READY" "$LAST"
  else
    echo "Publish failed. Will retry in 10 minutes."
  fi
} >>"$LOG" 2>&1

# Keep the log short
tail -n 300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
