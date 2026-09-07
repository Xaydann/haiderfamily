<?php
require_once 'config.php';
// spawn_family.php — create a brand new family tree seeded from one person
// in an existing tree, carrying their lineage across.
//
// Used by the "Create a family tree for this person" button. Creating a
// family is a privileged act (it mints a password), so it needs admin
// rights on the SOURCE family — which, when no admin password is
// configured, any signed-in editor has.

$source = require_family();
require_admin($source);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$personId = isset($input['personId']) ? (int)$input['personId'] : 0;
$newSlug  = sanitize_slug($input['slug'] ?? '');
$newName  = trim((string)($input['name'] ?? ''));
$password = (string)($input['password'] ?? '');
$mode     = ($input['mode'] ?? 'lineage'); // 'lineage' | 'person'

if ($newSlug === '' || $newSlug === 'main') {
    http_response_code(400);
    echo json_encode(['error' => '"main" is reserved — choose a different short name.']);
    exit;
}
if ($newName === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Give the new family a name.']);
    exit;
}
if (strlen($password) < 4) {
    http_response_code(400);
    echo json_encode(['error' => 'Choose a password at least 4 characters long.']);
    exit;
}

$registry = read_json_file(FAMILIES_FILE, ['families' => []]);
$families = $registry['families'] ?? [];
foreach ($families as $f) {
    if (($f['slug'] ?? '') === $newSlug) {
        http_response_code(409);
        echo json_encode(['error' => 'A family with that short name already exists.']);
        exit;
    }
}

$srcData = read_json_file($source['treeFile'], ['people' => [], 'events' => [], 'nextId' => 1]);
$people = $srcData['people'] ?? [];
$byId = [];
foreach ($people as $p) { if (isset($p['id'])) $byId[$p['id']] = $p; }
if (!isset($byId[$personId])) {
    http_response_code(404);
    echo json_encode(['error' => 'That person is not in this tree.']);
    exit;
}

// ---- Work out which people travel to the new tree ----
// "lineage" carries the person's whole BLOOD FAMILY, then their partners.
//
// Ancestors-plus-descendants alone isn't enough: it silently drops
// siblings, cousins, aunts and uncles, because those aren't descended from
// the person. So we first walk up to every ancestor, then walk DOWN from
// each of those — which sweeps up the rest of the blood family — and only
// then add partners so couples aren't split apart.
$take = [$personId => true];
if ($mode === 'lineage') {
    // 1. every ancestor
    $ancestors = [];
    $stack = [$personId];
    while ($stack) {
        $cur = array_pop($stack);
        foreach (($byId[$cur]['parents'] ?? []) as $pid) {
            if (isset($byId[$pid]) && !isset($ancestors[$pid])) {
                $ancestors[$pid] = true; $take[$pid] = true; $stack[] = $pid;
            }
        }
    }
    // 2. everyone descended from the person OR from any of their ancestors
    $stack = array_merge([$personId], array_keys($ancestors));
    while ($stack) {
        $cur = array_pop($stack);
        foreach ($people as $q) {
            if (!isset($q['id'])) continue;
            if (in_array($cur, $q['parents'] ?? [], true) && !isset($take[$q['id']])) {
                $take[$q['id']] = true; $stack[] = $q['id'];
            }
        }
    }
    // 3. partners of everyone taken, so no couple is split up
    foreach (array_keys($take) as $id) {
        foreach (($byId[$id]['partners'] ?? []) as $pt) {
            $pid = $pt['id'] ?? null;
            if ($pid !== null && isset($byId[$pid])) $take[$pid] = true;
        }
    }
}

// ---- Rebuild with fresh sequential ids, dropping links to anyone left behind ----
$idMap = [];
$next = 1;
foreach ($people as $p) {
    if (!isset($p['id']) || !isset($take[$p['id']])) continue;
    $idMap[$p['id']] = $next++;
}
$newPeople = [];
foreach ($people as $p) {
    if (!isset($p['id']) || !isset($take[$p['id']])) continue;
    $copy = $p;
    $copy['id'] = $idMap[$p['id']];
    $copy['parents'] = [];
    foreach (($p['parents'] ?? []) as $pid) {
        if (isset($idMap[$pid])) $copy['parents'][] = $idMap[$pid];
    }
    $copy['partners'] = [];
    foreach (($p['partners'] ?? []) as $pt) {
        $pid = $pt['id'] ?? null;
        if ($pid !== null && isset($idMap[$pid])) {
            $copy['partners'][] = ['id' => $idMap[$pid], 'status' => $pt['status'] ?? 'partner'];
        }
    }
    // The new tree is its own thing; don't carry a link pointing back to a
    // family this person now belongs to directly.
    unset($copy['linkedFamily']);
    $newPeople[] = $copy;
}

// Carry across events that involve only people who made the trip.
$newEvents = [];
foreach (($srcData['events'] ?? []) as $ev) {
    $ids = [];
    $ok = true;
    foreach (($ev['people'] ?? []) as $pid) {
        if (!isset($idMap[$pid])) { $ok = false; break; }
        $ids[] = $idMap[$pid];
    }
    if ($ok && $ids) { $ev['people'] = $ids; $newEvents[] = $ev; }
}

// ---- Register the family and write its tree ----
$families[] = [
    'slug' => $newSlug,
    'name' => mb_substr($newName, 0, 80),
    'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
];
if (!write_json_file(FAMILIES_FILE, ['families' => $families])) {
    http_response_code(500);
    echo json_encode(['error' => 'Could not save — check that data/ is writable.']);
    exit;
}

$newTreeFile = DATA_DIR . 'tree_' . $newSlug . '.json';
$ok = write_json_file($newTreeFile, [
    'title' => mb_substr($newName, 0, 120),
    'subtitle' => 'a quiet record of who belongs to whom',
    'people' => $newPeople,
    'events' => $newEvents,
    'nextId' => $next,
]);
if (!$ok) {
    http_response_code(500);
    echo json_encode(['error' => 'Family created, but its tree could not be saved — check that data/ is writable.']);
    exit;
}

// ---- Point the source person at their new tree ----
$linkedId = $idMap[$personId] ?? null;
foreach ($srcData['people'] as &$p) {
    if (($p['id'] ?? null) === $personId) {
        $p['linkedFamily'] = ['slug' => $newSlug, 'personId' => $linkedId];
        break;
    }
}
unset($p);
write_json_file($source['treeFile'], $srcData);

echo json_encode([
    'ok' => true,
    'slug' => $newSlug,
    'personId' => $linkedId,
    'imported' => count($newPeople),
    'url' => 'index.html?family=' . rawurlencode($newSlug) . ($linkedId ? '&person=' . $linkedId : ''),
]);