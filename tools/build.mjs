// Encrypt the board export into site/data.enc.json.
// Usage: node tools/build.mjs --export <dir> --site <site dir> --state <state dir>
// Format matches the page: gzip(JSON) -> AES-256-GCM, key from PBKDF2-SHA256(password, salt).
import crypto from "node:crypto";
import zlib from "node:zlib";
import path from "node:path";
import fs from "node:fs";
import { args, loadExport, readJson, writeJson, password, COLS } from "./common.mjs";

const a = args();
const exportDir = a.export, siteDir = a.site, stateDir = a.state;
if (!exportDir || !siteDir || !stateDir) {
  console.error("Usage: node tools/build.mjs --export <dir> --site <dir> --state <dir>");
  process.exit(2);
}

const db = loadExport(exportDir);
if (!db.cards.size) {
  console.error("Export has no cards. Not publishing an empty board.");
  process.exit(1);
}

const applied = readJson(path.join(stateDir, "applied.json"), []);
const recent = applied.filter((x) => Date.now() - Date.parse(x.at) < 14 * 864e5).map((x) => x.aid);

const payload = { publishedAt: new Date().toISOString(), applied: recent };
for (const col of COLS) payload[col] = [...db[col]].map(([id, doc]) => ({ ...doc, id }));

// One salt per password. A new password gets a new salt, which also signs out remembered browsers.
const pw = password();
const keyFile = path.join(stateDir, "key.json");
let k = readJson(keyFile, null);
const fp = crypto.createHash("sha256").update("wf-board:" + pw).digest("hex").slice(0, 16);
if (!k || k.fp !== fp) {
  k = { salt: crypto.randomBytes(16).toString("base64"), iter: 310000, fp };
  writeJson(keyFile, k);
}
const key = crypto.pbkdf2Sync(pw, Buffer.from(k.salt, "base64"), k.iter, 32, "sha256");
const iv = crypto.randomBytes(12);
const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
const c = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([c.update(gz), c.final(), c.getAuthTag()]);

const env = { v: 1, salt: k.salt, iter: k.iter, iv: iv.toString("base64"), ct: ct.toString("base64") };
fs.writeFileSync(path.join(siteDir, "data.enc.json"), JSON.stringify(env));
console.log(
  `Built data.enc.json: cards ${db.cards.size}, meetings ${db.meetings.size}, deals ${db.deals.size}, tasks ${db.tasks.size}, ` +
  `${Math.round(ct.length / 1024)} KB encrypted, ${recent.length} applied ids`
);
