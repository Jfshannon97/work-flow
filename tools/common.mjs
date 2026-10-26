// Shared helpers for the Work Flow website sync (Node 18+, no packages).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const COLS = ["cards", "meetings", "deals", "tasks"];

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

export const readJson = (p, dflt) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; }
};
export const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 1));
};

// Board export as written by ArtifactData list with out_dir: <dir>/<collection>/<docId>.json
export function loadExport(dir) {
  const db = {};
  for (const col of COLS) {
    const d = path.join(dir, col);
    db[col] = new Map();
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(".json")) continue;
      const doc = readJson(path.join(d, f), null);
      if (doc && typeof doc === "object") db[col].set(f.slice(0, -5), doc);
    }
  }
  return db;
}

// Password: WF_PASSWORD env var, else the macOS Keychain item "wf-board" (set by tools/set-password.sh)
export function password() {
  if (process.env.WF_PASSWORD) return process.env.WF_PASSWORD;
  try {
    return execFileSync("security", ["find-generic-password", "-a", "wf-board", "-s", "wf-board", "-w"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No board password. Run tools/set-password.sh first.");
  }
}
