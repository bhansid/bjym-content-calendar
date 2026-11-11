# BJYM J&K – Content Calendar (Arun Prabhat)

Planning calendar for national, international, festival, J&K, BJP/RSS days and leaders' Jayanti/Punyatithi,
with a content pool (images, videos, PDFs, voice notes), Claude reading uploads, PDF export and email reminders.

Hosted on **Netlify** (free plan is enough):

| Part | Where |
|---|---|
| App (page) | `public/index.html`, `public/shim.js` |
| Backend API | `netlify/functions/api.mjs` (served at `/api.php`) |
| Daily reminders | `netlify/functions/reminders.mjs` – runs 13:15 UTC = 6:45 PM IST |
| Data | Netlify Blobs: `calendar-docs` (events, pool, settings) and `calendar-files` (uploads) |
| Starting calendar | `netlify/lib/seed.mjs` – loaded automatically on first use |

## Environment variables (Netlify → Project configuration → Environment variables)

| Key | Required | What |
|---|---|---|
| `EDITOR_PASSWORD` | yes | Team password – can add/edit |
| `VIEWER_PASSWORD` | no | View-only password |
| `SESSION_SECRET` | yes | Any long random text (keeps logins secure) |
| `ANTHROPIC_API_KEY` | no | Turns on "Claude reads the poster / note" |
| `SMTP_USER` / `SMTP_PASS` | for emails | Gmail address + a Gmail **App Password** (Google Account → Security → 2-Step Verification → App passwords) |
| `SMTP_HOST` / `SMTP_PORT` | no | Defaults `smtp.gmail.com` / `465` |
| `MAIL_FROM_NAME` | no | Sender name, default "BJYM J&K Calendar" |

Change a variable → redeploy (Deploys → Trigger deploy) for it to take effect.

## Notes
- Uploads up to ~4 MB each (Netlify function limit) – fine for posters, photos and voice notes.
- Every push to `main` redeploys automatically. Data in Blobs is kept across deploys.
