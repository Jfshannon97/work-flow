# Work Flow website

A copy of the Work Flow board that opens in any browser with a password.
No Claude sign in needed.

## How it works
- The board data is published here as `data.enc.json`. It is encrypted (AES-256-GCM, key from the password via PBKDF2). Without the password it is unreadable.
- `index.html` is the board. It asks for the password, then shows BD Board, Meetings, Deal Board, and Tasks.
- Clicks (Sent, Hold, Pass, decisions, notes, tasks) show right away in that browser. They wait in the yellow bar.
- "Email updates to the board" opens one Outlook email to John with the changes. John hits Send.
- The sync task on John's Mac reads those emails, applies them to the board database, and republishes. Then the bar clears.

## Sync task (John's Mac)
Scheduled Claude task "Work Flow website sync". Each run:
1. Reads new "WF board update" emails from John to John (Outlook)
2. Exports the board database to `~/.wf-board/x`
3. `node tools/apply.mjs` plans the writes from the emails; Claude sends them to the board database; `--commit` marks them done
4. `tools/publish.sh` encrypts the export and pushes it here

Private state lives in `~/.wf-board/state` (never in this repo). The password lives in the macOS Keychain item `wf-board` (`tools/set-password.sh`).

## Change the password
Run `tools/set-password.sh`, then let the next sync run. Browsers that chose "Remember" will ask again.
