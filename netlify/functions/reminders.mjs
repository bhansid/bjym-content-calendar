// Daily reminder emails. Runs at 13:15 UTC = 6:45 PM IST.
// Every evening: "Tomorrow: …" if anything is on. Sundays: next week's digest.
import { listDocs, getDoc, mutate, occurrencesOn, istDate, sendMail, env, CAT_LABELS } from "../lib/core.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (iso, opts) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", ...opts });

export async function runReminders({ dry = false } = {}) {
  const cfg = (await getDoc("config", "reminders")) || {};
  const to = (cfg.emails || []).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const events = await listDocs("events");
  const appUrl = env("URL", "");
  const link = appUrl ? `<p style="margin-top:18px"><a href="${esc(appUrl)}" style="color:#c2500f;font-weight:700">Open the calendar →</a></p>` : "";
  const wrap = (inner) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1917;max-width:560px"><div style="border-top:4px solid #f26a1b;padding-top:10px;font-size:12px;color:#78716c;letter-spacing:.08em">BJYM J&amp;K · CONTENT CALENDAR</div>${inner}${link}</div>`;
  const log = []; let sent = 0;

  if (cfg.dayBefore !== false) {
    const tom = istDate(1);
    const list = occurrencesOn(events, tom);
    if (list.length) {
      const rows = list.map(ev => {
        const drive = (ev.drives || {})[String(ev.year)] || "";
        return `<li style="margin:0 0 12px"><b>${esc(ev.title)}</b> <span style="color:#78716c">· ${esc(CAT_LABELS[ev.cat] || "")}</span>`
          + (ev.verify ? ` <span style="color:#b45309">⚠ date to be confirmed</span>` : "")
          + (ev.note ? `<br><span style="color:#44403c">${esc(ev.note)}</span>` : "")
          + `<br>${drive ? `📁 <a href="${esc(drive)}">Creatives folder</a>` : `<span style="color:#b91c1c">No creatives folder yet</span>`}</li>`;
      }).join("");
      const subject = `Tomorrow: ${list[0].title}${list.length > 1 ? ` + ${list.length - 1} more` : ""}`;
      const ok = dry || await sendMail(to, subject, wrap(`<h2 style="margin:8px 0">Tomorrow – ${fmt(tom, { weekday: "short", day: "numeric", month: "short" })}</h2><ul style="padding-left:18px">${rows}</ul>`));
      log.push(`day-before: ${subject} → ${ok ? "sent" : "FAILED"}`); if (ok) sent++;
    } else log.push("day-before: nothing tomorrow");
  }

  const todayIso = istDate(0);
  if (cfg.weekly !== false && new Date(todayIso + "T00:00:00Z").getUTCDay() === 0) {
    let html = "", total = 0, missing = 0;
    for (let i = 1; i <= 7; i++) {
      const d = istDate(i), list = occurrencesOn(events, d);
      if (!list.length) continue;
      html += `<h3 style="margin:14px 0 4px">${fmt(d, { weekday: "short", day: "numeric", month: "short" })}</h3><ul style="padding-left:18px;margin:0">`;
      for (const ev of list) {
        total++; const drive = (ev.drives || {})[String(ev.year)] || ""; if (!drive) missing++;
        html += `<li>${esc(ev.title)} <span style="color:#78716c">· ${esc(CAT_LABELS[ev.cat] || "")}</span>${drive ? ` · <a href="${esc(drive)}">📁</a>` : ""}</li>`;
      }
      html += "</ul>";
    }
    const subject = `Next week on the calendar (${fmt(istDate(1), { day: "numeric", month: "short" })} – ${fmt(istDate(7), { day: "numeric", month: "short" })})`;
    const bodyHtml = total ? html + `<p style="margin-top:14px"><b>${missing} of ${total}</b> still need a creatives folder.</p>` : "<p>Nothing on the calendar next week.</p>";
    const ok = dry || await sendMail(to, subject, wrap(`<h2 style="margin:8px 0">${esc(subject)}</h2>${bodyHtml}`));
    log.push(`weekly: ${total} events → ${ok ? "sent" : "FAILED"}`); if (ok) sent++;
  }

  if (!to.length) log.push("No recipient emails saved in Reminders.");
  if (!dry) {
    const now = new Date(Date.now() + 5.5 * 3600 * 1000);
    const stamp = now.toISOString().slice(0, 16).replace("T", " ") + " IST";
    await mutate("config", (docs) => {
      docs.reminders = { ...(docs.reminders || {}), sender: "active", lastRun: `${stamp} – ${sent ? `sent ${sent} email${sent > 1 ? "s" : ""}` : "nothing to send"}` };
    });
  }
  console.log(log.join("\n"));
  return log;
}

export default async () => { await runReminders(); };

export const config = { schedule: "15 13 * * *" }; // 13:15 UTC = 6:45 PM IST
