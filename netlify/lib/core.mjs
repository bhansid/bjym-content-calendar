// Shared backend code for the calendar (Netlify Functions).
import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import tls from "node:tls";
import seed from "./seed.mjs";

export const env = (k, d = "") => {
  try { const v = globalThis.Netlify?.env?.get(k); if (v !== undefined && v !== null) return v; } catch (_) {}
  return process.env[k] ?? d;
};

export const COLLECTIONS = ["events", "pool", "config"];
export const CAT_LABELS = {
  national: "National Day", intl: "International Day", festival: "Festival", jk: "J&K Local",
  bjp: "BJP / RSS", birthday: "Birthday / Jayanti", tribute: "Punyatithi / Balidan",
  other: "Other Communities", custom: "Our Event",
};

// ---------- document store: one JSON blob per collection ----------
const docsStore = () => getStore({ name: "calendar-docs", consistency: "strong" });
export const filesStore = () => getStore({ name: "calendar-files", consistency: "strong" });

async function readCollection(c) {
  const s = docsStore();
  const entry = await s.getWithMetadata(c, { type: "json" });
  if (entry === null) {
    if (c === "events" || c === "config") {
      // First run: load the starting calendar.
      const docs = {};
      for (const d of seed) if (d.c === c) docs[d.id] = d.data;
      await s.setJSON(c, docs, { onlyIfNew: true });
      const again = await s.getWithMetadata(c, { type: "json" });
      return { docs: again?.data || docs, etag: again?.etag };
    }
    return { docs: {}, etag: undefined };
  }
  return { docs: entry.data || {}, etag: entry.etag };
}
export async function listDocs(c) {
  const { docs } = await readCollection(c);
  return Object.entries(docs).map(([id, data]) => ({ id, data }));
}
export async function getDoc(c, id) {
  const { docs } = await readCollection(c);
  return docs[id] ?? null;
}
// Read-modify-write with an ETag check so two people saving at once don't overwrite each other.
export async function mutate(c, fn) {
  const s = docsStore();
  for (let i = 0; i < 6; i++) {
    const { docs, etag } = await readCollection(c);
    const result = fn(docs);
    const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const { modified } = await s.setJSON(c, docs, opts);
    if (modified) return result;
    await new Promise(r => setTimeout(r, 80 + Math.random() * 200));
  }
  throw new Error("busy");
}

// ---------- sessions (signed cookie) ----------
const secret = () => env("SESSION_SECRET") || ("cal:" + env("EDITOR_PASSWORD"));
const sign = (v) => createHmac("sha256", secret()).update(v).digest("base64url");
export function makeSession(role) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const v = `${role}.${exp}`;
  return `${v}.${sign(v)}`;
}
export function readSession(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)apcal_s=([^;]+)/);
  if (!m) return "";
  const [role, exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!role || !exp || !sig) return "";
  const good = sign(`${role}.${exp}`);
  if (good.length !== sig.length || !timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return "";
  if (+exp < Date.now()) return "";
  return role === "editor" || role === "viewer" ? role : "";
}
export const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---------- which events fall on a date ----------
export function occurrencesOn(events, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const out = [];
  for (const { id, data: ev } of events) {
    if (!ev?.date) continue;
    const [ey, em, ed] = ev.date.split("-").map(Number);
    const hit = ev.yearly ? (em === m && ed === d && y >= ey && !(ev.skip || []).includes(y)) : ev.date === iso;
    if (hit) out.push({ ...ev, id, year: y });
  }
  return out;
}
// Today's date in India
export function istDate(offsetDays = 0) {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86400000);
  return t.toISOString().slice(0, 10);
}

// ---------- email over SMTP (Gmail app password, Hostinger mail, etc.) ----------
export async function sendMail(to, subject, html) {
  const host = env("SMTP_HOST", "smtp.gmail.com"), port = +env("SMTP_PORT", "465");
  const user = env("SMTP_USER"), pass = env("SMTP_PASS"), from = env("MAIL_FROM") || user;
  const fromName = env("MAIL_FROM_NAME", "BJYM J&K Calendar");
  if (!user || !pass || !to.length) return false;
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
  const msg = [
    `From: ${enc(fromName)} <${from}>`, `To: ${to.join(", ")}`, `Subject: ${enc(subject)}`,
    `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64").replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: host }, () => {});
    let buf = "", step = 0;
    const cmds = [
      ["EHLO calendar", "250"], ["AUTH LOGIN", "334"], [Buffer.from(user).toString("base64"), "334"],
      [Buffer.from(pass).toString("base64"), "235"], [`MAIL FROM:<${from}>`, "250"],
      ...to.map(r => [`RCPT TO:<${r}>`, "25"]), ["DATA", "354"], [msg + "\r\n.", "250"], ["QUIT", "221"],
    ];
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 20000);
    sock.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last)) return;              // wait for the final line of the reply
      buf = "";
      if (step > 0 && !last.startsWith(cmds[step - 1][1])) { clearTimeout(timer); sock.end(); resolve(false); return; }
      if (step === 0 && !last.startsWith("220")) { clearTimeout(timer); sock.end(); resolve(false); return; }
      if (step === cmds.length) { clearTimeout(timer); sock.end(); resolve(true); return; }
      sock.write(cmds[step][0] + "\r\n"); step++;
    });
    sock.on("error", () => { clearTimeout(timer); resolve(false); });
  });
}
