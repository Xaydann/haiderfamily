<?php
require_once 'config.php';

$family = require_family();
require_auth($family['slug']); // the whole forum is private — reading and posting both need the family's password

$default = ['posts' => [], 'nextId' => 1];
$action = $_GET['action'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $data = read_json_file($family['forumFile'], $default);

    if ($action === 'get') {
        $id = (int)($_GET['id'] ?? 0);
        $post = null;
        foreach ($data['posts'] as $p) { if ($p['id'] === $id) { $post = $p; break; } }
        if (!$post) { http_response_code(404); echo json_encode(['error' => 'Post not found']); exit; }
        echo json_encode($post);
        exit;
    }

    // list newest first
    $posts = $data['posts'];
    usort($posts, fn($a, $b) => strcmp($b['date'], $a['date']));
    echo json_encode(['posts' => $posts]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = read_json_file($family['forumFile'], $default);
    $input = json_decode(file_get_contents('php://input'), true);

    if ($action === 'create_post') {
        $title = trim((string)($input['title'] ?? ''));
        $author = trim((string)($input['author'] ?? 'Family member'));
        $body = trim((string)($input['body'] ?? ''));
        if ($title === '' || $body === '') {
            http_response_code(400); echo json_encode(['error' => 'Title and body are required']); exit;
        }
        $post = [
            'id' => $data['nextId'],
            'title' => mb_substr($title, 0, 150),
            'author' => mb_substr($author !== '' ? $author : 'Family member', 0, 60),
            'body' => mb_substr($body, 0, 10000),
            'date' => date('c'),
            'comments' => [],
        ];
        $data['posts'][] = $post;
        $data['nextId']++;
        write_json_file($family['forumFile'], $data);
        echo json_encode($post);
        exit;
    }

    if ($action === 'create_comment') {
        $id = (int)($input['postId'] ?? 0);
        $author = trim((string)($input['author'] ?? 'Family member'));
        $body = trim((string)($input['body'] ?? ''));
        if ($body === '') { http_response_code(400); echo json_encode(['error' => 'Comment cannot be empty']); exit; }
        $found = false;
        foreach ($data['posts'] as &$p) {
            if ($p['id'] === $id) {
                $p['comments'][] = [
                    'author' => mb_substr($author !== '' ? $author : 'Family member', 0, 60),
                    'body' => mb_substr($body, 0, 4000),
                    'date' => date('c'),
                ];
                $found = true;
                break;
            }
        }
        unset($p);
        if (!$found) { http_response_code(404); echo json_encode(['error' => 'Post not found']); exit; }
        write_json_file($family['forumFile'], $data);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'delete_post') {
        require_admin($family); // deleting is destructive — admin only (or any editor if no admin tier is set up)
        $id = (int)($input['id'] ?? 0);
        $data['posts'] = array_values(array_filter($data['posts'], fn($p) => $p['id'] !== $id));
        write_json_file($family['forumFile'], $data);
        echo json_encode(['ok' => true]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Unknown action']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);