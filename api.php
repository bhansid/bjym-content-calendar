<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 30, 'httponly' => true, 'samesite' => 'Lax',
    'secure' => !empty($_SERVER['HTTPS'])]);
session_start();

function out($data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $msg, int $code = 400, string $err = 'bad_request'): never { out(['error' => $err, 'message' => $msg], $code); }
function role(): string { return $_SESSION['role'] ?? ''; }
function need_role(string $r): void {
    if (role() === '') fail('Please log in', 401, 'login');
    if ($r === 'editor' && role() !== 'editor') fail('View-only access', 403, 'invalid_argument');
}
function body(): array {
    $j = json_decode(file_get_contents('php://input') ?: '[]', true);
    return is_array($j) ? $j : [];
}
function coll(string $c): string { if (!in_array($c, COLLECTIONS, true)) fail('Unknown collection'); return $c; }
function clean_id(string $id): string {
    if (!preg_match('/^[A-Za-z0-9_\-.:@+~]{1,128}$/', $id)) fail('Bad id');
    return $id;
}

$action = $_GET['action'] ?? '';
$isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
if ($isPost && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'calendar') fail('Bad request', 400);

switch ($action) {

case 'login':
    $p = (string)(body()['password'] ?? '');
    usleep(300000);
    if (EDITOR_PASSWORD !== '' && hash_equals(EDITOR_PASSWORD, $p)) $_SESSION['role'] = 'editor';
    elseif (VIEWER_PASSWORD !== '' && hash_equals(VIEWER_PASSWORD, $p)) $_SESSION['role'] = 'viewer';
    else fail('Wrong password', 401, 'login');
    session_regenerate_id(true);
    out(['role' => role()]);

case 'logout':
    $_SESSION = []; session_destroy(); out(['ok' => true]);

case 'me':
    out(['role' => role(), 'ai' => ANTHROPIC_API_KEY !== '', 'installed' => is_file(__DIR__ . '/data/installed.lock')]);

case 'list':
    need_role('viewer');
    out(['docs' => doc_list(coll($_GET['c'] ?? ''))]);

case 'get':
    need_role('viewer');
    $d = doc_get(coll($_GET['c'] ?? ''), clean_id($_GET['id'] ?? ''));
    out(['exists' => $d !== null, 'data' => $d]);

case 'set':
case 'update':
    need_role('editor');
    $b = body();
    $c = coll((string)($b['c'] ?? '')); $id = clean_id((string)($b['id'] ?? ''));
    $data = $b['data'] ?? null;
    if (!is_array($data)) fail('No data');
    if (strlen(json_encode($data)) > 256 * 1024) fail('Too large');
    if ($action === 'update') {
        $cur = doc_get($c, $id);
        if ($cur === null) fail('Not found', 400, 'invalid_argument');
        foreach ($data as $k => $v) { if ($v === null) unset($cur[$k]); else $cur[$k] = $v; }
        $data = $cur;
    }
    doc_set($c, $id, $data);
    out(['ok' => true]);

case 'delete':
    need_role('editor');
    $b = body();
    doc_delete(coll((string)($b['c'] ?? '')), clean_id((string)($b['id'] ?? '')));
    out(['ok' => true]);

case 'upload':
    need_role('editor');
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail($f && $f['error'] === UPLOAD_ERR_INI_SIZE ? 'File too large for the server' : 'Upload failed', 400, 'too_large');
    if ($f['size'] > MAX_UPLOAD_MB * 1024 * 1024) fail('File too large', 400, 'too_large');
    $type = (string)($_POST['type'] ?? $f['type'] ?? 'application/octet-stream');
    if (!preg_match('#^(image|video|audio)/[\w.+-]+$|^application/pdf$#', $type)) fail('Unsupported file type', 400, 'unsupported_type');
    $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
    $ext = preg_match('/^[a-z0-9]{1,5}$/', $ext) ? $ext : 'bin';
    $id = bin2hex(random_bytes(16));
    if (!move_uploaded_file($f['tmp_name'], __DIR__ . "/uploads/$id.$ext")) fail('Could not save file', 500);
    doc_set('files', $id, ['ext' => $ext, 'type' => $type, 'name' => $f['name'], 'size' => $f['size']]);
    out(['id' => $id, 'url' => "api.php?action=file&id=$id", 'sizeBytes' => $f['size'], 'contentType' => $type]);

case 'file':
    need_role('viewer');
    $id = clean_id($_GET['id'] ?? '');
    $meta = doc_get('files', $id);
    $path = $meta ? __DIR__ . "/uploads/$id.{$meta['ext']}" : '';
    if (!$meta || !is_file($path)) { http_response_code(404); exit; }
    header('Content-Type: ' . $meta['type']);
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    header('Content-Disposition: inline; filename="' . preg_replace('/[^\w.\- ]/', '_', $meta['name']) . '"');
    readfile($path);
    exit;

case 'file_delete':
    need_role('editor');
    $id = clean_id((string)(body()['id'] ?? ''));
    $meta = doc_get('files', $id);
    if ($meta) { @unlink(__DIR__ . "/uploads/$id.{$meta['ext']}"); doc_delete('files', $id); }
    out(['deleted' => (bool)$meta]);

case 'ai':
    need_role('editor');
    if (ANTHROPIC_API_KEY === '') fail('Claude is not set up', 400, 'not_granted');
    $prompt = (string)($_POST['prompt'] ?? '');
    if ($prompt === '' || strlen($prompt) > 200000) fail('Bad prompt');
    $content = [];
    if (!empty($_POST['imageId'])) {
        $iid = clean_id((string)$_POST['imageId']);
        $meta = doc_get('files', $iid);
        $p = $meta ? __DIR__ . "/uploads/$iid.{$meta['ext']}" : '';
        if ($meta && is_file($p) && filesize($p) < 5 * 1024 * 1024 && in_array($meta['type'], ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true)) {
            $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $meta['type'], 'data' => base64_encode(file_get_contents($p))]];
        }
    }
    $content[] = ['type' => 'text', 'text' => $prompt];
    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 90,
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . ANTHROPIC_API_KEY, 'anthropic-version: 2023-06-01'],
        CURLOPT_POSTFIELDS => json_encode(['model' => ANTHROPIC_MODEL, 'max_tokens' => 800,
            'messages' => [['role' => 'user', 'content' => $content]]])]);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $j = json_decode((string)$res, true);
    if ($code !== 200 || !isset($j['content'][0]['text'])) fail('Claude did not answer (' . $code . ')', 502, $code === 429 ? 'rate_limited' : 'upstream_error');
    out(['text' => $j['content'][0]['text']]);

default:
    fail('Unknown action', 404);
}
