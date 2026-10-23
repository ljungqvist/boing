<?php
// Boing upload server on Kapsi (https://ljungqvist.info/boing/), the public twin of tools/devserver.py.
//   GET  /boing/                              page with links to the APKs (GitHub releases)
//   PUT  /boing/upload?session=S&name=N       saves the body to <data>/uploads/S/N
//        header X-Boing-Key must match <data>/upload-key
// <data> is ~/sites/ljungqvist.info/boing-data, next to www/ (the web host doesn't see the rest of ~).
// Deploy: tools/kapsi.sh deploy. Fetch the uploads: tools/kapsi.sh pull.

const MAX_BYTES = 500 * 1000 * 1000;
$data = dirname(__DIR__, 2) . '/boing-data';

function reply(int $code, string $body, string $type = 'text/plain; charset=utf-8'): void {
    http_response_code($code);
    header("Content-Type: $type");
    echo $body;
    exit;
}

/** A plain file or folder name (no paths). */
function safe(?string $name): ?string {
    if ($name === null) return null;
    $name = basename(str_replace('\\', '/', $name));
    if ($name === '' || $name[0] === '.' || preg_match('/[\x00-\x1f]/', $name)) return null;
    return $name;
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if (!preg_match('#/upload$#', $path)) {
    if ($method !== 'GET' && $method !== 'HEAD') reply(405, 'method not allowed');
    reply(200, <<<HTML
<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>
<title>Boing</title>
<h2>Boing APKs</h2>
<ul style='font-size:20px;line-height:2'>
<li><a href="https://github.com/ljungqvist/boing/releases/latest/download/boing.apk">boing.apk</a> (stable)</li>
<li><a href="https://github.com/ljungqvist/boing/releases/download/dev-latest/boing-dev.apk">boing-dev.apk</a> (testing)</li>
</ul>
HTML, 'text/html; charset=utf-8');
}

if ($method !== 'PUT' && $method !== 'POST') reply(405, 'method not allowed');

$want = @file_get_contents("$data/upload-key");
$got = $_SERVER['HTTP_X_BOING_KEY'] ?? '';
if ($want === false || trim($want) === '' || !hash_equals(trim($want), $got)) reply(403, 'bad key');

$session = safe($_GET['session'] ?? null);
$name = safe($_GET['name'] ?? null);
if ($session === null || $name === null) reply(400, 'need session and name');

$length = (int)($_SERVER['CONTENT_LENGTH'] ?? -1);
if ($length > MAX_BYTES) reply(413, 'too large');

$dir = "$data/uploads/$session";
if (!is_dir($dir) && !mkdir($dir, 0700, true)) reply(500, 'cannot create folder');
$tmp = "$dir/$name.part";
$in = fopen('php://input', 'rb');
$out = fopen($tmp, 'wb');
if (!$in || !$out) reply(500, 'cannot write');
$n = 0;
while (!feof($in)) {
    $chunk = fread($in, 1 << 20);
    if ($chunk === false) break;
    $n += strlen($chunk);
    if ($n > MAX_BYTES) { fclose($out); unlink($tmp); reply(413, 'too large'); }
    fwrite($out, $chunk);
}
fclose($out);
if ($length >= 0 && $n !== $length) { unlink($tmp); reply(400, 'incomplete'); }
rename($tmp, "$dir/$name");
reply(200, 'ok');
