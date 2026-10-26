#!/usr/bin/env python3
"""Turn "WF Updates" emails into Work Flow board writes. Python 3.8+, standard library only.

Runs inside the Claude scheduled-task sandbox, so it must not need node, the Keychain, or git.

Plan:   python3 apply.py --inbox <dir of email .txt> --export <dir> --state <dir> --out <dir>
        Writes <out>/writes.json ([{op, collection, doc_id, file_path}]) and <out>/summary.txt.
        Each write still needs the doc's current version (if_version) when sent with ArtifactData.
Commit: python3 apply.py --commit --export <dir> --state <dir> --out <dir>
        Run only after every write in writes.json succeeded. Marks the actions applied and
        patches the local export so the next publish shows them.
"""
import argparse
import base64
import json
import os
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone

MARK = "WFA1"
COLS = ["cards", "meetings", "deals", "tasks"]

# Fields the website may change. Anything else in an email is ignored.
UPDATE_FIELDS = {
    "cards": ["status", "tab", "fromTab", "statusDate", "holdDate", "followUpDate", "followUpSetBy", "enaiaDone",
              "notes", "picks", "passed", "recycledMet", "recycledDate", "updatedAt"],
    "meetings": ["decision", "nextDate", "decisionDate", "reviewDue", "enaiaDone", "history", "notes", "updatedAt"],
    "deals": ["notes", "youOwe", "ballOwner", "ballOwnerSetBy", "ballOwnerSetDate", "phases", "phase", "phaseSetBy",
              "phaseSetDate", "dealType", "flagMove", "flagDate", "dismissedAttention", "updatedAt"],
    "tasks": ["title", "category", "due", "priority", "done", "doneOn", "added", "note", "source", "cardId",
              "meetingId", "dealId", "company", "updatedAt"],
}
# New documents the page can create: a meeting from "Meeting set", a card from "Back to pool", any task.
CREATE_FIELDS = {
    "cards": UPDATE_FIELDS["cards"] + ["company", "address", "sf", "lex", "landlord", "industry", "dm", "enaiaId",
                                       "createdAt"],
    "meetings": UPDATE_FIELDS["meetings"] + ["company", "cardId", "source", "address", "sf", "lex", "landlord",
                                             "industry", "dm", "metDate", "metNote", "folder", "stage", "lastTouch",
                                             "lastTouchNote", "summary", "sinceReview", "suggested", "subject",
                                             "body", "notesLoggedText", "createdAt"],
    "deals": [],
    "tasks": UPDATE_FIELDS["tasks"],
}
SAFE_ID = re.compile(r"^[A-Za-z0-9_\-.~:@+]{1,200}$")


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=1, ensure_ascii=False)


def load_export(d):
    db = {}
    for col in COLS:
        db[col] = {}
        cd = os.path.join(d, col)
        if not os.path.isdir(cd):
            continue
        for f in os.listdir(cd):
            if f.endswith(".json"):
                doc = read_json(os.path.join(cd, f), None)
                if isinstance(doc, dict):
                    db[col][f[:-5]] = doc
    return db


def pick(obj, keys):
    return {k: v for k, v in (obj or {}).items() if k in keys}


def safe_id(s):
    return isinstance(s, str) and bool(SAFE_ID.match(s)) and s not in (".", "..")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


def decode(b64):
    s = re.sub(r"\s+", "", b64).replace("-", "+").replace("_", "/")
    s += "=" * ((4 - len(s) % 4) % 4)
    return json.loads(base64.b64decode(s).decode("utf-8"))


def commit(a):
    applied_file = os.path.join(a.state, "applied.json")
    pend = read_json(os.path.join(a.out, "pending.json"), None)
    if not pend:
        print("Nothing to commit.")
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    keep = [x for x in read_json(applied_file, []) if parse_iso(x.get("at")) > cutoff]
    t = now_iso()
    write_json(applied_file, keep + [{"aid": aid, "at": t} for aid in pend["aids"]])
    for w in pend["writes"]:
        f = os.path.join(a.export, w["collection"], w["doc_id"] + ".json")
        if w["op"] == "delete":
            if os.path.exists(f):
                os.remove(f)
            continue
        data = read_json(w["file_path"], {})
        base = read_json(f, {}) if w["op"] == "update" else {}
        base.update(data)
        write_json(f, base)
    os.remove(os.path.join(a.out, "pending.json"))
    print(f"Committed {len(pend['aids'])} actions, {len(pend['writes'])} writes.")


def plan(a):
    applied = read_json(os.path.join(a.state, "applied.json"), [])
    done = {x.get("aid") for x in applied}
    db = load_export(a.export)
    notes, actions = [], {}

    files = sorted(os.listdir(a.inbox)) if os.path.isdir(a.inbox) else []
    block = re.compile(MARK + r":([A-Za-z0-9_\-\s]+?):" + MARK)
    for f in files:
        with open(os.path.join(a.inbox, f), encoding="utf-8", errors="replace") as fh:
            txt = fh.read()
        found = 0
        for m in block.finditer(txt):
            found += 1
            try:
                for x in decode(m.group(1)).get("actions") or []:
                    if isinstance(x, dict) and x.get("aid") and x["aid"] not in actions:
                        actions[x["aid"]] = x
            except Exception:
                notes.append(f"{f}: update block could not be read (edited email?)")
        if not found:
            notes.append(f"{f}: no update block found")

    todo = sorted((x for x in actions.values() if x["aid"] not in done), key=lambda x: str(x.get("at", "")))
    per_doc, skipped = {}, []  # skipped = processed but not written, so the page stops showing them as waiting
    for x in todo:
        col, did, op = x.get("col"), x.get("id"), x.get("op")
        if col not in COLS or not safe_id(did) or op not in ("update", "set", "delete"):
            notes.append(f"Skipped a bad action ({col}/{did} {op})")
            skipped.append(x["aid"])
            continue
        key = f"{col}/{did}"
        exists = did in db[col]
        cur = per_doc.get(key) or {"col": col, "id": did, "op": None, "data": {}, "aids": []}
        if op == "delete":
            if col != "tasks":
                notes.append(f"Skipped delete of {key} (only tasks can be deleted)")
                skipped.append(x["aid"])
                continue
            cur.update(op="delete" if exists else "skip", data={})
        elif op == "set" and not exists and cur["op"] != "update":
            if not CREATE_FIELDS[col]:
                notes.append(f"Skipped new {key} (not allowed)")
                skipped.append(x["aid"])
                continue
            cur["op"] = "set"
            cur["data"].update(pick(x.get("data"), CREATE_FIELDS[col]))
        else:
            if not exists and cur["op"] != "set":
                notes.append(f"Skipped {key}: not on the board any more")
                cur["aids"].append(x["aid"])
                per_doc[key] = cur
                continue
            fields = CREATE_FIELDS[col] if cur["op"] == "set" else UPDATE_FIELDS[col]
            cur["op"] = cur["op"] or "update"
            cur["data"].update(pick(x.get("data"), fields))
        cur["aids"].append(x["aid"])
        per_doc[key] = cur

    shutil.rmtree(a.out, ignore_errors=True)
    os.makedirs(os.path.join(a.out, "docs"), exist_ok=True)
    writes, lines = [], []
    for d in per_doc.values():
        src = db[d["col"]].get(d["id"]) or d["data"]
        label = src.get("company") or src.get("name") or src.get("title") or d["id"]
        if not d["op"] or d["op"] == "skip" or (d["op"] == "update" and not d["data"]):
            continue
        w = {"op": d["op"], "collection": d["col"], "doc_id": d["id"]}
        if d["op"] != "delete":
            w["file_path"] = os.path.abspath(os.path.join(a.out, "docs", f"{d['col']}__{d['id']}.json"))
            write_json(w["file_path"], d["data"])
        writes.append(w)
        shown = ", ".join(k for k in d["data"] if k != "updatedAt")
        lines.append(f"{d['op']} {d['col']}/{d['id']} ({label})" + (f": {shown}" if shown else ""))

    aids = [aid for d in per_doc.values() for aid in d["aids"]] + skipped
    write_json(os.path.join(a.out, "writes.json"), writes)
    if aids:
        write_json(os.path.join(a.out, "pending.json"), {"aids": aids, "writes": writes})
    summary = "\n".join([f"Actions found: {len(actions)}. New: {len(todo)}. Writes: {len(writes)}."] + lines +
                        ["NOTE: " + n for n in notes]) + "\n"
    with open(os.path.join(a.out, "summary.txt"), "w", encoding="utf-8") as f:
        f.write(summary)
    print(summary)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--inbox")
    p.add_argument("--export", required=True)
    p.add_argument("--state", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--commit", action="store_true")
    a = p.parse_args()
    if a.commit:
        commit(a)
    elif not a.inbox:
        sys.exit("Missing --inbox")
    else:
        plan(a)


if __name__ == "__main__":
    main()
