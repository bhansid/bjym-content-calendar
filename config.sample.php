<?php
// ============================================================
//  Arun Prabhat – Content Calendar : SETTINGS
//  Copy this file to config.php ON THE SERVER and fill it in.
//  config.php is never committed to Git, so your passwords stay private.
// ============================================================

// --- Passwords -------------------------------------------------
// Team members who can add / edit / delete:
const EDITOR_PASSWORD = 'change-me-editor';
// People who can only look and download PDFs (leave '' to disable):
const VIEWER_PASSWORD = 'change-me-viewer';

// --- Database --------------------------------------------------
// Leave DB_HOST empty to use a built-in SQLite file (zero setup).
// To use MySQL: hPanel → Databases → create a database + user,
// then fill these in (host is usually 'localhost').
const DB_HOST = '';
const DB_NAME = '';
const DB_USER = '';
const DB_PASS = '';

// --- Claude (reads posters, notes and voice transcripts) -------
// Get a key at https://console.anthropic.com → API Keys.
// Leave empty to switch the "Claude reads it" feature off.
const ANTHROPIC_API_KEY = '';
const ANTHROPIC_MODEL   = 'claude-sonnet-5-5';

// --- Reminder emails -------------------------------------------
// Create a mailbox in hPanel → Emails (e.g. calendar@yourdomain.com)
// and use it here. SMTP is the most reliable way to send.
const MAIL_FROM      = '';              // e.g. calendar@yourdomain.com
const MAIL_FROM_NAME = 'BJYM J&K Calendar';
const SMTP_HOST      = 'smtp.hostinger.com';
const SMTP_PORT      = 465;             // SSL
const SMTP_USER      = '';              // usually same as MAIL_FROM
const SMTP_PASS      = '';              // that mailbox's password
// Public address of the calendar (used as the link inside emails):
const APP_URL        = 'https://yourdomain.com/calendar/';

// --- Uploads ---------------------------------------------------
const MAX_UPLOAD_MB = 50;
