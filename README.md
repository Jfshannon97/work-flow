# Work Flow website

A copy of the Work Flow board that opens in any browser with a password.
No Claude sign in needed.

## How it works
- The board data is published here as `data.enc.json`. It is encrypted (AES-256-GCM, key from the password via PBKDF2). Without the password it is unreadable.
- `index.html` is the board. It asks for the password, then shows BD Board, Meetings, Deal Board, and Tasks.
- Clicks (Sent, Hold, Pass, decisions, notes, tasks) show right away in that browser. They wait in the yellow bar.
- "Email updates to the board" opens one Outlook email to John with the changes. John hits Send.
- The sync task on John's Mac reads those emails, applies them to the board database, and republishes. Then the bar clears.

## Sync (two parts)
1. Scheduled Claude task "Work Flow website sync" (hourly, runs in Claude's Linux sandbox): reads "WF Updates" emails, applies the clicks to the board database (`tools/apply.py`), exports the board to `~/.wf-board/x`, and writes `x/.ready`. Steps: `tools/sync-task.md`
2. Mac launch agent `com.wfboard.publish` (every 10 minutes, no Claude): when `x/.ready` is new, encrypts with the Keychain password and pushes (`tools/mac-publish.sh` calls `tools/publish.sh`). Install with `tools/install-mac-publish.sh`. Log: `~/.wf-board/state/publish.log`

Private state lives in `~/.wf-board/state` (never in this repo). The password lives in the macOS Keychain item `wf-board` (`tools/set-password.sh`).

## Change the password
Run `tools/set-password.sh`, then let the next sync run. Browsers that chose "Remember" will ask again.
