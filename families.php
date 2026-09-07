<?php
require_once 'config.php';
// Public: lets the front end list which families exist, so it can offer a
// switcher. Only slugs and display names are returned — never password
// hashes, which only ever live inside data/families.json.

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$mainTree = read_json_file(TREE_FILE, ['title' => 'Family Tree']);
$list = [['slug' => 'main', 'name' => $mainTree['title'] ?? 'Family Tree']];

$registry = read_json_file(FAMILIES_FILE, ['families' => []]);
foreach (($registry['families'] ?? []) as $f) {
    $slug = $f['slug'] ?? '';
    if ($slug === '' || $slug === 'main') continue;
    $t = read_json_file(DATA_DIR . 'tree_' . $slug . '.json', ['title' => $f['name'] ?? $slug]);
    $list[] = ['slug' => $slug, 'name' => $t['title'] ?? ($f['name'] ?? $slug)];
}

echo json_encode(['families' => $list]);
