<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
header('Content-Type: text/html; charset=utf-8');
$lock = __DIR__ . '/data/installed.lock';
$msgs = [];
$ok = true;
try {
    if (is_file($lock)) {
        $msgs[] = ['ok', 'Already installed. Nothing to do – you can delete install.php.'];
    } else {
        if (EDITOR_PASSWORD === 'change-me-editor') { $ok = false; $msgs[] = ['err', 'Set EDITOR_PASSWORD in config.php first.']; }
        if (!is_writable(__DIR__ . '/data') || !is_writable(__DIR__ . '/uploads')) { $ok = false; $msgs[] = ['err', 'The data/ and uploads/ folders must be writable (permission 755).']; }
        if ($ok) {
            db();
            $n = (int)db()->query("SELECT COUNT(*) FROM docs WHERE c='events'")->fetchColumn();
            if ($n === 0) {
                $seed = json_decode(file_get_contents(__DIR__ . '/data/seed.json'), true);
                db()->beginTransaction();
                foreach ($seed as $d) doc_set($d['c'], $d['id'], $d['data']);
                db()->commit();
                $msgs[] = ['ok', 'Imported ' . count($seed) . ' calendar entries.'];
            } else {
                $msgs[] = ['ok', "Database already has $n events – kept as they are."];
            }
            $msgs[] = ['ok', 'Database: ' . (DB_HOST === '' ? 'SQLite file (data/calendar.sqlite)' : 'MySQL ' . DB_NAME)];
            $msgs[] = [ANTHROPIC_API_KEY ? 'ok' : 'warn', ANTHROPIC_API_KEY ? 'Claude is set up.' : 'No ANTHROPIC_API_KEY – the "Claude reads it" feature is off until you add one.'];
            $msgs[] = [MAIL_FROM ? 'ok' : 'warn', MAIL_FROM ? 'Reminder emails will come from ' . MAIL_FROM : 'MAIL_FROM is empty – reminder emails are off until you fill it in.'];
            file_put_contents($lock, date('c'));
            $msgs[] = ['ok', 'Done! Delete install.php from the server now, then open the calendar.'];
        }
    }
} catch (Throwable $e) {
    $msgs[] = ['err', 'Error: ' . htmlspecialchars($e->getMessage())];
}
?><!DOCTYPE html><html><head><meta charset="utf-8"><title>Install – Content Calendar</title>
<style>body{font-family:system-ui,sans-serif;max-width:620px;margin:60px auto;padding:0 20px;color:#1c1917}
p{padding:10px 14px;border-radius:8px}.ok{background:#ecfdf3}.warn{background:#fff7ed}.err{background:#fef2f2}a{color:#c2500f;font-weight:700}</style></head>
<body><h1>Content Calendar – setup</h1>
<?php foreach ($msgs as [$c, $m]) echo "<p class=\"$c\">$m</p>"; ?>
<p><a href="./">Open the calendar →</a></p></body></html>
