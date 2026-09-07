<?php
require_once 'config.php';

$family = require_family();

$default = [
    'title' => 'Family Tree',
    'subtitle' => 'a quiet record of who belongs to whom',
    'people' => [],
    'events' => [],
    'nextId' => 1,
];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Viewing a family's tree is public — no password needed.
    $data = read_json_file($family['treeFile'], $default);
    echo json_encode($data);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Saving changes requires that family's password.
    require_auth($family['slug']);
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input) || !isset($input['people']) || !is_array($input['people'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid payload']);
        exit;
    }
    // Lock enforcement, server-side. The UI already hides these actions,
    // but the check has to live here too — otherwise "locked" would be a
    // cosmetic lock that any crafted request could walk straight past.
    // When no admin password is configured this is a no-op, so existing
    // sites behave exactly as before.
    if (family_has_admin($family) && !is_admin($family['slug'])) {
        $existing = read_json_file($family['treeFile'], $default);
        $lockedBefore = [];
        foreach (($existing['people'] ?? []) as $p) {
            if (!empty($p['locked'])) $lockedBefore[$p['id']] = $p;
        }
        $incomingById = [];
        foreach ($input['people'] as $p) {
            if (isset($p['id'])) $incomingById[$p['id']] = $p;
        }
        foreach ($lockedBefore as $id => $before) {
            // A locked person may not be deleted...
            if (!isset($incomingById[$id])) {
                http_response_code(403);
                echo json_encode(['error' => 'That person is locked. The admin password is needed to delete them.']);
                exit;
            }
            // ...nor modified, including unlocking themselves.
            $after = $incomingById[$id];
            if (json_encode($before) !== json_encode($after)) {
                http_response_code(403);
                echo json_encode(['error' => 'That person is locked. The admin password is needed to edit them.']);
                exit;
            }
        }
        // Non-admins also can't newly lock someone (locking is an admin act).
        foreach ($input['people'] as $p) {
            $id = $p['id'] ?? null;
            if ($id !== null && !empty($p['locked']) && !isset($lockedBefore[$id])) {
                http_response_code(403);
                echo json_encode(['error' => 'Locking a person needs the admin password.']);
                exit;
            }
        }
    }

    $data = [
        'title' => isset($input['title']) ? mb_substr(trim((string)$input['title']), 0, 120) : $default['title'],
        'subtitle' => isset($input['subtitle']) ? mb_substr(trim((string)$input['subtitle']), 0, 200) : $default['subtitle'],
        'people' => $input['people'],
        'events' => (isset($input['events']) && is_array($input['events'])) ? $input['events'] : [],
        'nextId' => isset($input['nextId']) ? (int)$input['nextId'] : 1,
    ];
    if (!write_json_file($family['treeFile'], $data)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not save — check that data/ is writable (permissions 755 or 775).']);
        exit;
    }
    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);