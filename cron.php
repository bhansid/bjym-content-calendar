<?php
// Daily reminder emails. Run once a day in the evening (IST) from hPanel → Advanced → Cron Jobs:
//   php /home/<your-user>/public_html/calendar/cron.php
// Test from the command line without sending:  php cron.php --dry
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require __DIR__ . '/lib.php';

$dry = in_array('--dry', $argv, true);
$cfg = doc_get('config', 'reminders') ?? [];
$to = array_values(array_filter($cfg['emails'] ?? [], fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
$events = doc_list('events');
$log = [];
$esc = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
$link = '<p style="margin-top:18px"><a href="' . $esc(APP_URL) . '" style="color:#c2500f;font-weight:700">Open the calendar →</a></p>';
$wrap = fn($inner) => '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1917;max-width:560px">'
    . '<div style="border-top:4px solid #f26a1b;padding-top:10px;font-size:12px;color:#78716c;letter-spacing:.08em">BJYM J&amp;K · CONTENT CALENDAR</div>' . $inner . $link . '</div>';

$today = new DateTimeImmutable('today');
$sent = 0;

// --- day-before reminder
if (!empty($cfg['dayBefore'])) {
    $tom = $today->modify('+1 day');
    $list = occurrences_on($events, $tom->format('Y-m-d'));
    if ($list) {
        $rows = '';
        foreach ($list as $ev) {
            $drive = $ev['drives'][(string)$ev['year']] ?? '';
            $rows .= '<li style="margin:0 0 12px"><b>' . $esc($ev['title']) . '</b> <span style="color:#78716c">· ' . $esc(CAT_LABELS[$ev['cat']] ?? '') . '</span>'
                . (!empty($ev['verify']) ? ' <span style="color:#b45309">⚠ date to be confirmed</span>' : '')
                . (!empty($ev['note']) ? '<br><span style="color:#44403c">' . $esc($ev['note']) . '</span>' : '')
                . '<br>' . ($drive ? '📁 <a href="' . $esc($drive) . '">Creatives folder</a>' : '<span style="color:#b91c1c">No creatives folder yet</span>') . '</li>';
        }
        $subject = 'Tomorrow: ' . $list[0]['title'] . (count($list) > 1 ? ' + ' . (count($list) - 1) . ' more' : '');
        $html = $wrap('<h2 style="margin:8px 0">Tomorrow – ' . $tom->format('D, j M') . '</h2><ul style="padding-left:18px">' . $rows . '</ul>');
        $ok = $dry ?: send_mail($to, $subject, $html);
        $log[] = ($dry ? '[dry] ' : '') . "day-before: $subject → " . ($ok ? 'sent' : 'FAILED');
        if ($ok) $sent++;
    } else $log[] = 'day-before: nothing tomorrow';
}

// --- Sunday weekly digest
if (!empty($cfg['weekly']) && $today->format('N') === '7') {
    $html = ''; $total = 0; $missing = 0;
    for ($i = 1; $i <= 7; $i++) {
        $d = $today->modify("+$i day");
        $list = occurrences_on($events, $d->format('Y-m-d'));
        if (!$list) continue;
        $html .= '<h3 style="margin:14px 0 4px">' . $d->format('D j M') . '</h3><ul style="padding-left:18px;margin:0">';
        foreach ($list as $ev) {
            $total++;
            $drive = $ev['drives'][(string)$ev['year']] ?? '';
            if (!$drive) $missing++;
            $html .= '<li>' . $esc($ev['title']) . ' <span style="color:#78716c">· ' . $esc(CAT_LABELS[$ev['cat']] ?? '') . '</span>'
                . ($drive ? ' · <a href="' . $esc($drive) . '">📁</a>' : '') . '</li>';
        }
        $html .= '</ul>';
    }
    $mon = $today->modify('+1 day'); $sun = $today->modify('+7 day');
    $subject = 'Next week on the calendar (' . $mon->format('j M') . ' – ' . $sun->format('j M') . ')';
    $body = $total ? $html . "<p style=\"margin-top:14px\"><b>$missing of $total</b> still need a creatives folder.</p>" : '<p>Nothing on the calendar next week.</p>';
    $ok = $dry ?: send_mail($to, $subject, $wrap('<h2 style="margin:8px 0">' . $esc($subject) . '</h2>' . $body));
    $log[] = ($dry ? '[dry] ' : '') . "weekly: $total events → " . ($ok ? 'sent' : 'FAILED');
    if ($ok) $sent++;
}

if (!$to) $log[] = 'No recipient emails saved in Reminders.';
if (!$dry) {
    $cfg['sender'] = 'active';
    $cfg['lastRun'] = date('j M Y, g:i A') . ' – ' . ($sent ? "sent $sent email" . ($sent > 1 ? 's' : '') : 'nothing to send');
    doc_set('config', 'reminders', $cfg);
}
echo implode("\n", $log), "\n";
