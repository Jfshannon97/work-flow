// Turn "WF board update" emails into board writes.
//
// Plan:   node tools/apply.mjs --inbox <dir of email .txt> --export <dir> --state <dir> --out <dir>
//         Writes <out>/writes.json ([{op, collection, doc_id, file_path}]) and <out>/summary.txt.
//         Each write still needs the doc's current version (if_version) when it is sent with ArtifactData.
// Commit: node tools/apply.mjs --commit --export <dir> --state <dir> --out <dir>
//         Run only after every write in writes.json succeeded. Marks the actions applied and
//         patches the local export so the next build shows them.
import fs from "node:fs";
import path from "node:path";
import { args, loadExport, readJson, writeJson, COLS } from "./common.mjs";

const MARK = "WFA1";
const a = args();
for (const k of ["export", "state", "out"]) if (!a[k]) { console.error(`Missing --${k}`); process.exit(2); }
const outDir = a.out, stateDir = a.state;

// Fields the website may change. Anything else in an email is ignored.
const UPDATE_FIELDS = {
  cards: ["status", "tab", "fromTab", "statusDate", "holdDate", "followUpDate", "followUpSetBy", "enaiaDone", "notes",
    "picks", "passed", "recycledMet", "recycledDate", "updatedAt"],
  meetings: ["decision", "nextDate", "decisionDate", "reviewDue", "enaiaDone", "history", "notes", "updatedAt"],
  deals: ["notes", "youOwe", "ballOwner", "ballOwnerSetBy", "ballOwnerSetDate", "phases", "phase", "phaseSetBy",
    "phaseSetDate", "dealType", "flagMove", "flagDate", "dismissedAttention", "updatedAt"],
  tasks: ["title", "category", "due", "priority", "done", "doneOn", "added", "note", "source", "cardId", "meetingId",
    "dealId", "company", "updatedAt"],
};
// New documents the page can create: a meeting from "Meeting set", a card from "Back to pool", any task.
const CREATE_FIELDS = {
  cards: [...UPDATE_FIELDS.cards, "company", "address", "sf", "lex", "landlord", "industry", "dm", "enaiaId", "createdAt"],
  meetings: [...UPDATE_FIELDS.meetings, "company", "cardId", "source", "address", "sf", "lex", "landlord", "industry", "dm",
    "metDate", "metNote", "folder", "stage", "lastTouch", "lastTouchNote", "summary", "sinceReview", "suggested", "subject",
    "body", "notesLoggedText", "createdAt"],
  deals: [],
  tasks: UPDATE_FIELDS.tasks,
};
const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)));
const safeId = (s) => typeof s === "string" && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(s) && !/^\.\.?$/.test(s);

const appliedFile = path.join(stateDir, "applied.json");
const applied = readJson(appliedFile, []);

if (a.commit) {
  const pend = readJson(path.join(outDir, "pending.json"), null);
  if (!pend) { console.log("Nothing to commit."); process.exit(0); }
  const now = new Date().toISOString();
  const keep = applied.filter((x) => Date.now() - Date.parse(x.at) < 30 * 864e5);
  writeJson(appliedFile, [...keep, ...pend.aids.map((aid) => ({ aid, at: now }))]);
  for (const w of pend.writes) {
    const f = path.join(a.export, w.collection, w.doc_id + ".json");
    if (w.op === "delete") { fs.rmSync(f, { force: true }); continue; }
    const data = readJson(w.file_path, {});
    const base = w.op === "update" ? readJson(f, {}) : {};
    writeJson(f, { ...base, ...data });
  }
  fs.rmSync(path.join(outDir, "pending.json"));
  console.log(`Committed ${pend.aids.length} actions, ${pend.writes.length} writes.`);
  process.exit(0);
}

// ---- Plan ----
if (!a.inbox) { console.error("Missing --inbox"); process.exit(2); }
const done = new Set(applied.map((x) => x.aid));
const db = loadExport(a.export);
const notes = [];
const actions = new Map();

function decode(b64) {
  const s = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64").toString("utf8"));
}
for (const f of fs.existsSync(a.inbox) ? fs.readdirSync(a.inbox) : []) {
  const txt = fs.readFileSync(path.join(a.inbox, f), "utf8");
  const re = new RegExp(`${MARK}:([A-Za-z0-9_\\-\\s]+?):${MARK}`, "g");
  let m, found = 0;
  while ((m = re.exec(txt))) {
    found++;
    try {
      const p = decode(m[1]);
      for (const x of p.actions || []) if (x && x.aid && !actions.has(x.aid)) actions.set(x.aid, x);
    } catch { notes.push(`${f}: update block could not be read (edited email?)`); }
  }
  if (!found) notes.push(`${f}: no update block found`);
}

const todo = [...actions.values()].filter((x) => !done.has(x.aid)).sort((x, y) => String(x.at).localeCompare(String(y.at)));
const perDoc = new Map(); // "col/id" -> {col, id, op, data, aids}
const skipped = []; // processed but not written, so the page stops showing them as waiting
for (const x of todo) {
  if (!COLS.includes(x.col) || !safeId(x.id) || !["update", "set", "delete"].includes(x.op)) {
    notes.push(`Skipped a bad action (${x.col}/${x.id} ${x.op})`); skipped.push(x.aid); continue;
  }
  const key = x.col + "/" + x.id;
  const exists = db[x.col].has(x.id);
  let cur = perDoc.get(key) || { col: x.col, id: x.id, op: null, data: {}, aids: [] };
  if (x.op === "delete") {
    if (x.col !== "tasks") { notes.push(`Skipped delete of ${key} (only tasks can be deleted)`); skipped.push(x.aid); continue; }
    cur = { ...cur, op: exists ? "delete" : "skip", data: {} };
  } else if (x.op === "set" && !exists && cur.op !== "update") {
    if (!CREATE_FIELDS[x.col].length) { notes.push(`Skipped new ${key} (not allowed)`); skipped.push(x.aid); continue; }
    cur.op = "set"; cur.data = { ...cur.data, ...pick(x.data, CREATE_FIELDS[x.col]) };
  } else {
    if (!exists && cur.op !== "set") { notes.push(`Skipped ${key}: not on the board any more`); cur.aids.push(x.aid); perDoc.set(key, cur); continue; }
    const fields = cur.op === "set" ? CREATE_FIELDS[x.col] : UPDATE_FIELDS[x.col];
    cur.op = cur.op || "update"; cur.data = { ...cur.data, ...pick(x.data, fields) };
  }
  cur.aids.push(x.aid);
  perDoc.set(key, cur);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "docs"), { recursive: true });
const writes = [];
const lines = [];
for (const d of perDoc.values()) {
  const label = (db[d.col].get(d.id) || d.data).company || (db[d.col].get(d.id) || d.data).name || (db[d.col].get(d.id) || d.data).title || d.id;
  if (!d.op || d.op === "skip" || (d.op === "update" && !Object.keys(d.data).length)) continue;
  const w = { op: d.op, collection: d.col, doc_id: d.id };
  if (d.op !== "delete") {
    w.file_path = path.resolve(outDir, "docs", `${d.col}__${d.id}.json`);
    writeJson(w.file_path, d.data);
  }
  writes.push(w);
  const shown = Object.keys(d.data).filter((k) => k !== "updatedAt").join(", ");
  lines.push(`${d.op} ${d.col}/${d.id} (${label})${shown ? ": " + shown : ""}`);
}
const aids = [...perDoc.values()].flatMap((d) => d.aids).concat(skipped);
writeJson(path.join(outDir, "writes.json"), writes);
if (aids.length) writeJson(path.join(outDir, "pending.json"), { aids, writes });
fs.writeFileSync(path.join(outDir, "summary.txt"),
  [`Actions found: ${actions.size}. New: ${todo.length}. Writes: ${writes.length}.`, ...lines, ...notes.map((n) => "NOTE: " + n)].join("\n") + "\n");
console.log(fs.readFileSync(path.join(outDir, "summary.txt"), "utf8"));
