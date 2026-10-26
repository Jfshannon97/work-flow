#!/bin/zsh
# Save the Work Flow website password in this Mac's Keychain (item "wf-board").
# The sync job reads it from there. It is never written to a file or to GitHub.
# Changing it signs out every browser that chose "Remember on this computer".
set -e
echo "Pick a long password you can type on a work computer (4+ words is good)."
echo "You will be asked for it twice by the Keychain tool."
security delete-generic-password -a wf-board -s wf-board >/dev/null 2>&1 || true
security add-generic-password -U -a wf-board -s wf-board -l "Work Flow website" -w
echo "Saved. Next sync publishes the board with this password."
