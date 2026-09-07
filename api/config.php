<?php
// config.php — shared configuration for the family site backend.
//
// Supports multiple families, each with their own password. The site
// always has a built-in "main" family — that's your original tree, backed
// by data/tree.json and data/forum.json exactly as before, using the
// EDIT_PASSWORD_HASH below. Nothing about your existing setup changes.
//
// To add more families, use api/add_family.php once each (see README.md).
// Their data lives in data/tree_{slug}.json / data/forum_{slug}.json.

error_reporting(E_ALL);
ini_set('display_errors', '0'); // set to '1' temporarily if you need to debug an error

// ---- MAIN FAMILY'S PASSWORD ----
// 1. Open api/generate_hash.php?password=yourChosenPassword in a browser once.
// 2. Copy the long string it prints and paste it below, between the quotes.
// 3. Delete generate_hash.php from the server afterwards — don't leave it up.
define('EDIT_PASSWORD_HASH', '$2y$10$JaeYDouXVLc/iRubqVTB1OlyHVSmCIvDWrvq6hpMc4deAU222Djr6');

// ---- OPTIONAL ADMIN PASSWORD (main family) ----
// A second, stronger password with extra powers: locking/unlocking people,
// editing locked people, and deleting forum posts.
//
// LEAVE THIS AS-IS IF YOU DON'T WANT AN ADMIN TIER. While it's unset,
// everyone who knows the normal family password keeps exactly the
// abilities they have today — so adding this can never lock you out.
// Once you set it, those specific actions require the admin password.
// Generate it the same way as above with api/generate_hash.php.
define('ADMIN_PASSWORD_HASH', '$2y$10$fAuDuBOecK8qyT8404UC/ed6F.P/KW09DYlj0Ojmmm4.CVjtQ5o.6');

define('DATA_DIR', __DIR__ . '/../data/');
define('UPLOADS_DIR', __DIR__ . '/../uploads/');
// If your site is at yoursite.infinityfreeapp.com/ (root), leave as '/uploads/'.
// If it's at yoursite.infinityfreeapp.com/family/, change to '/family/uploads/'.
define('UPLOADS_URL', '/uploads/');

define('TREE_FILE', DATA_DIR . 'tree.json');
define('FORUM_FILE', DATA_DIR . 'forum.json');
define('FAMILIES_FILE', DATA_DIR . 'families.json');

// Some hosts (InfinityFree included) don't give PHP a reliable, writable
// place to store session files, or run different requests under slightly
// different execution contexts — PHP's default session files are only
// readable by whichever process created them (mode 0600), so if a later
// request runs under a different context, it can see the file exists but
// can't actually read it. That looks exactly like "session expired" right
// after signing in, even though the cookie is fine.
//
// To rule that out entirely, we take over session storage ourselves and
// force every session file to be readable/writable regardless of which
// process touches it, instead of trusting PHP's default file permissions.
class FamilySiteSessionHandler implements SessionHandlerInterface {
    private $dir;
    public function __construct($dir) { $this->dir = rtrim($dir, '/') . '/'; }
    public function open($savePath, $sessionName): bool { return true; }
    public function close(): bool { return true; }
    public function read($id): string {
        $file = $this->dir . 'sess_' . preg_replace('/[^a-zA-Z0-9,\-]/', '', $id);
        if (!is_file($file)) return '';
        $data = @file_get_contents($file);
        return $data === false ? '' : $data;
    }
    public function write($id, $data): bool {
        $file = $this->dir . 'sess_' . preg_replace('/[^a-zA-Z0-9,\-]/', '', $id);
        $ok = @file_put_contents($file, $data, LOCK_EX) !== false;
        if ($ok) @chmod($file, 0666); // readable/writable no matter which process reads it next
        return $ok;
    }
    public function destroy($id): bool {
        $file = $this->dir . 'sess_' . preg_replace('/[^a-zA-Z0-9,\-]/', '', $id);
        if (is_file($file)) @unlink($file);
        return true;
    }
    public function gc($maxLifetime): int {
        $count = 0;
        foreach ((glob($this->dir . 'sess_*') ?: []) as $file) {
            if (is_file($file) && filemtime($file) + $maxLifetime < time()) {
                @unlink($file);
                $count++;
            }
        }
        return $count;
    }
}

$sessionDir = DATA_DIR . 'sessions/';
if (!is_dir($sessionDir)) {
    @mkdir($sessionDir, 0777, true);
}
@chmod($sessionDir, 0777);
if (is_dir($sessionDir) && is_writable($sessionDir)) {
    session_set_save_handler(new FamilySiteSessionHandler($sessionDir), true);
    // Keep the session files themselves from being reachable directly.
    $htaccess = $sessionDir . '.htaccess';
    if (!file_exists($htaccess)) {
        @file_put_contents($htaccess, "Require all denied\nDeny from all\n");
    }
}

session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 7, // stay signed in for a week
    'path' => '/',
    'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();


header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

if (!function_exists('mb_substr')) {
    // Fallback for hosts without the mbstring extension enabled.
    function mb_substr($str, $start, $length = null) {
        return substr($str, $start, $length === null ? strlen($str) : $length);
    }
}

// A slug identifies which family's data to use. Restricted to a safe
// character set so it can never be used to escape the data/ directory
// (no dots, slashes, etc.) — this is the one thing that MUST stay strict,
// since it feeds directly into a file path below.
function sanitize_slug($raw) {
    $slug = strtolower((string)$raw);
    $slug = preg_replace('/[^a-z0-9\-]/', '', $slug);
    $slug = substr($slug, 0, 40);
    return $slug === '' ? 'main' : $slug;
}

// Reads which family is being requested, from either GET or the request body.
function current_family_slug() {
    $raw = $_GET['family'] ?? ($_POST['family'] ?? 'main');
    return sanitize_slug($raw);
}

// Resolves a slug to everything needed to serve it: its data files and its
// password hash. Returns null for a slug that isn't "main" and isn't a
// registered family in data/families.json.
function resolve_family($slug) {
    $slug = sanitize_slug($slug);
    if ($slug === 'main') {
        return [
            'slug' => 'main',
            'treeFile' => TREE_FILE,
            'forumFile' => FORUM_FILE,
            'passwordHash' => defined('EDIT_PASSWORD_HASH') ? EDIT_PASSWORD_HASH : '',
            'adminHash' => defined('ADMIN_PASSWORD_HASH') ? ADMIN_PASSWORD_HASH : '',
        ];
    }
    $registry = read_json_file(FAMILIES_FILE, ['families' => []]);
    foreach (($registry['families'] ?? []) as $f) {
        if (($f['slug'] ?? '') === $slug) {
            return [
                'slug' => $slug,
                'treeFile' => DATA_DIR . 'tree_' . $slug . '.json',
                'forumFile' => DATA_DIR . 'forum_' . $slug . '.json',
                'passwordHash' => $f['passwordHash'] ?? '',
                'adminHash' => $f['adminHash'] ?? '',
            ];
        }
    }
    return null;
}

// Looks up (or requires) an already-resolved family for the current
// request. Call this once near the top of each api/*.php entry point.
function require_family() {
    $family = resolve_family(current_family_slug());
    if (!$family) {
        http_response_code(404);
        echo json_encode(['error' => 'Unknown family']);
        exit;
    }
    return $family;
}

function is_authed($slug) {
    $slug = sanitize_slug($slug);
    return !empty($_SESSION['authed_families']) && in_array($slug, $_SESSION['authed_families'], true);
}

function require_auth($slug) {
    if (!is_authed($slug)) {
        http_response_code(401);
        echo json_encode(['error' => 'Please sign in with this family\'s password to do that.']);
        exit;
    }
}

// Is the current session an admin for this family?
function is_admin($slug) {
    $slug = sanitize_slug($slug);
    return !empty($_SESSION['admin_families']) && in_array($slug, $_SESSION['admin_families'], true);
}

// Does this family actually have an admin tier configured? If not, the
// normal family password retains full powers — this is what guarantees
// that introducing the admin feature can't lock an existing site out.
function family_has_admin($family) {
    return !empty($family['adminHash']);
}

// True if the session may perform an admin-only action for this family:
// either they're a real admin, or no admin tier exists yet and they're a
// signed-in editor.
function can_admin($family) {
    if (!is_authed($family['slug'])) return false;
    if (!family_has_admin($family)) return true; // no admin configured -> editors keep full rights
    return is_admin($family['slug']);
}

function require_admin($family) {
    if (!can_admin($family)) {
        http_response_code(403);
        echo json_encode(['error' => 'That action needs the admin password.']);
        exit;
    }
}

function read_json_file($path, $fallback) {
    if (!file_exists($path)) return $fallback;
    $raw = file_get_contents($path);
    $data = json_decode($raw, true);
    return $data === null ? $fallback : $data;
}

function write_json_file($path, $data) {
    $ok = file_put_contents(
        $path,
        json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );
    return $ok !== false;
}