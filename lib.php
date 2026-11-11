<?php
declare(strict_types=1);
if (!is_file(__DIR__ . '/config.php')) {
    http_response_code(500);
    exit('Setup needed: copy config.sample.php to config.php and fill in your settings (see SETUP-GUIDE.txt).');
}
require __DIR__ . '/config.php';
date_default_timezone_set('Asia/Kolkata');

const COLLECTIONS = ['events', 'pool', 'config'];

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    if (DB_HOST !== '') {
        $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec("CREATE TABLE IF NOT EXISTS docs (
            c VARCHAR(32) NOT NULL, id VARCHAR(128) NOT NULL, data MEDIUMTEXT NOT NULL,
            updated_at VARCHAR(32) NOT NULL, PRIMARY KEY (c, id)) DEFAULT CHARSET=utf8mb4");
    } else {
        $pdo = new PDO('sqlite:' . __DIR__ . '/data/calendar.sqlite', null, null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec("CREATE TABLE IF NOT EXISTS docs (c TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
            updated_at TEXT NOT NULL, PRIMARY KEY (c, id))");
    }
    return $pdo;
}

function doc_list(string $c): array {
    $st = db()->prepare('SELECT id, data FROM docs WHERE c = ?');
    $st->execute([$c]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $out[] = ['id' => $r['id'], 'data' => json_decode($r['data'], true)];
    return $out;
}
function doc_get(string $c, string $id): ?array {
    $st = db()->prepare('SELECT data FROM docs WHERE c = ? AND id = ?');
    $st->execute([$c, $id]);
    $v = $st->fetchColumn();
    return $v === false ? null : json_decode($v, true);
}
function doc_set(string $c, string $id, array $data): void {
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    $now = date('c');
    if (DB_HOST !== '') {
        $st = db()->prepare('INSERT INTO docs (c,id,data,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at)');
    } else {
        $st = db()->prepare('INSERT INTO docs (c,id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(c,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at');
    }
    $st->execute([$c, $id, $json, $now]);
}
function doc_delete(string $c, string $id): void {
    db()->prepare('DELETE FROM docs WHERE c = ? AND id = ?')->execute([$c, $id]);
}

// ---------- events: which ones fall on a date ----------
function occurrences_on(array $events, string $iso): array {
    [$y, $m, $d] = array_map('intval', explode('-', $iso));
    $out = [];
    foreach ($events as $e) {
        $ev = $e['data'];
        if (!isset($ev['date'])) continue;
        [$ey, $em, $ed] = array_map('intval', explode('-', $ev['date']));
        $hit = !empty($ev['yearly'])
            ? ($em === $m && $ed === $d && $y >= $ey && !in_array($y, $ev['skip'] ?? [], false))
            : ($ev['date'] === $iso);
        if ($hit) $out[] = $ev + ['id' => $e['id'], 'year' => $y];
    }
    return $out;
}

const CAT_LABELS = ['national' => 'National Day', 'intl' => 'International Day', 'festival' => 'Festival',
    'jk' => 'J&K Local', 'bjp' => 'BJP / RSS', 'birthday' => 'Birthday / Jayanti', 'tribute' => 'Punyatithi / Balidan',
    'other' => 'Other Communities', 'custom' => 'Our Event'];

// ---------- email ----------
function send_mail(array $to, string $subject, string $html): bool {
    if (!$to || MAIL_FROM === '') return false;
    if (SMTP_USER !== '' && SMTP_PASS !== '') return smtp_send($to, $subject, $html);
    $headers = "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n"
        . 'From: ' . mb_encode_mimeheader(MAIL_FROM_NAME) . ' <' . MAIL_FROM . ">\r\n";
    return mail(implode(',', $to), mb_encode_mimeheader($subject, 'UTF-8'), $html, $headers);
}
function smtp_send(array $to, string $subject, string $html): bool {
    $fp = @stream_socket_client('ssl://' . SMTP_HOST . ':' . SMTP_PORT, $errno, $err, 20);
    if (!$fp) return false;
    $read = function () use ($fp) { $s = ''; while (($l = fgets($fp, 515)) !== false) { $s .= $l; if (isset($l[3]) && $l[3] === ' ') break; } return $s; };
    $cmd = function (string $c, string $expect) use ($fp, $read) { fwrite($fp, $c . "\r\n"); return str_starts_with($read(), $expect); };
    $read();
    $ok = $cmd('EHLO calendar', '250') && $cmd('AUTH LOGIN', '334') && $cmd(base64_encode(SMTP_USER), '334')
        && $cmd(base64_encode(SMTP_PASS), '235') && $cmd('MAIL FROM:<' . MAIL_FROM . '>', '250');
    foreach ($to as $r) $ok = $ok && $cmd('RCPT TO:<' . $r . '>', '25');
    $ok = $ok && $cmd('DATA', '354');
    if ($ok) {
        $msg = 'From: ' . mb_encode_mimeheader(MAIL_FROM_NAME) . ' <' . MAIL_FROM . ">\r\n"
            . 'To: ' . implode(', ', $to) . "\r\n"
            . 'Subject: ' . mb_encode_mimeheader($subject, 'UTF-8') . "\r\n"
            . 'Date: ' . date('r') . "\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html));
        $ok = $cmd($msg . "\r\n.", '250');
    }
    $cmd('QUIT', '221');
    fclose($fp);
    return $ok;
}
