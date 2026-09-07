<?php
require_once 'config.php';
// Adds a new family, or resets an existing one's password — used whenever
// you want to add another branch of relatives with their own login.
//
// Unlike generate_hash.php, this tool is meant to be used more than once
// (any time you add a family), so it isn't a "delete after use" script.
// Instead it's protected by requiring you to already be signed in to the
// MAIN family tree in this same browser — sign in at yoursite.com/ first,
// then come back to this page. That keeps it from being an open door for
// anyone who happens to find the URL.

function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES); }

$authedAsMain = is_authed('main');
$message = '';
$messageType = ''; // 'ok' | 'error'

if ($authedAsMain && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $slug = sanitize_slug($_POST['slug'] ?? '');
    $name = trim((string)($_POST['name'] ?? ''));
    $password = (string)($_POST['password'] ?? '');

    if ($slug === '' || $slug === 'main') {
        $message = '"main" is reserved for your original tree — pick a different slug, e.g. "smith" or "jones".';
        $messageType = 'error';
    } elseif ($name === '') {
        $message = 'Please give the family a display name.';
        $messageType = 'error';
    } elseif (strlen($password) < 4) {
        $message = 'Choose a password at least 4 characters long.';
        $messageType = 'error';
    } else {
        $registry = read_json_file(FAMILIES_FILE, ['families' => []]);
        $families = $registry['families'] ?? [];
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $found = false;
        foreach ($families as &$f) {
            if (($f['slug'] ?? '') === $slug) {
                $f['name'] = mb_substr($name, 0, 80);
                $f['passwordHash'] = $hash;
                $found = true;
                break;
            }
        }
        unset($f);
        if (!$found) {
            $families[] = ['slug' => $slug, 'name' => mb_substr($name, 0, 80), 'passwordHash' => $hash];
        }
        if (write_json_file(FAMILIES_FILE, ['families' => $families])) {
            $message = ($found ? 'Updated' : 'Created') . ' the family "' . h($name) . '". '
                . 'They can now view their tree at yoursite.com/?family=' . h($slug)
                . ' and sign in with the password you just set.';
            $messageType = 'ok';
        } else {
            $message = 'Could not save — check that data/ is writable (permissions 755 or 775).';
            $messageType = 'error';
        }
    }
}

$existing = read_json_file(FAMILIES_FILE, ['families' => []])['families'] ?? [];
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Add a family</title>
<style>
  body{ font-family:-apple-system,Segoe UI,Inter,sans-serif; max-width:520px; margin:60px auto; padding:0 20px; color:#1b1e1a; }
  h1{ font-size:20px; }
  label{ display:block; font-size:13px; font-weight:600; margin:16px 0 6px; }
  input{ width:100%; padding:9px 11px; border:1px solid #d9dad2; border-radius:8px; font-size:14px; box-sizing:border-box; }
  button{ margin-top:20px; background:#2f4a3c; color:#fff; border:none; border-radius:8px; padding:10px 18px; font-size:14px; cursor:pointer; }
  .msg{ padding:10px 12px; border-radius:8px; font-size:13.5px; margin-top:16px; }
  .msg.ok{ background:#e4ebe4; color:#2f4a3c; }
  .msg.error{ background:#fbeceb; color:#b3413a; }
  .existing{ margin-top:30px; font-size:13px; color:#6b6f66; }
  .existing li{ margin-bottom:4px; }
  a{ color:#2f4a3c; }
</style>
</head>
<body>
<?php if (!$authedAsMain): ?>
  <h1>Sign in required</h1>
  <p>Sign in to the <strong>main</strong> family tree first (at your site's homepage), then reload this page.</p>
  <p><a href="../index.html">Go to the family tree</a></p>
<?php else: ?>
  <h1>Add or update a family</h1>
  <p style="font-size:13.5px;color:#6b6f66;">Each family gets its own slug (used in the URL), display name, and password.
  Using a slug that already exists will reset that family's password.</p>
  <?php if ($message): ?><div class="msg <?= $messageType ?>"><?= $message ?></div><?php endif; ?>
  <form method="post">
    <label>Slug (URL-safe, e.g. "smith")</label>
    <input type="text" name="slug" pattern="[a-z0-9\-]+" required placeholder="smith">
    <label>Display name</label>
    <input type="text" name="name" required placeholder="The Smith Family">
    <label>Password</label>
    <input type="text" name="password" required minlength="4" placeholder="choose a password">
    <button type="submit">Save family</button>
  </form>
  <?php if ($existing): ?>
    <div class="existing">
      <strong>Existing families:</strong>
      <ul>
        <?php foreach ($existing as $f): ?>
          <li><?= h($f['name'] ?? '') ?> — <code><?= h($f['slug'] ?? '') ?></code></li>
        <?php endforeach; ?>
      </ul>
    </div>
  <?php endif; ?>
<?php endif; ?>
</body>
</html>
