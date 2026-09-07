<?php
require_once 'config.php';

$family = require_family();
$slug = $family['slug'];
$action = $_GET['action'] ?? ($_POST['action'] ?? 'status');

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'login') {
    $input = json_decode(file_get_contents('php://input'), true);
    $password = (string)($input['password'] ?? '');
    // The admin password is checked FIRST, so an admin signing in through
    // the normal box gets admin rights automatically — one password box,
    // two tiers, no separate login screen to get confused by.
    $isAdminPassword = $password !== '' && !empty($family['adminHash'])
        && password_verify($password, $family['adminHash']);
    $isEditorPassword = $password !== '' && $family['passwordHash'] !== ''
        && password_verify($password, $family['passwordHash']);

    if ($isAdminPassword || $isEditorPassword) {
        session_regenerate_id(true);
        if (!isset($_SESSION['authed_families']) || !is_array($_SESSION['authed_families'])) {
            $_SESSION['authed_families'] = [];
        }
        if (!in_array($slug, $_SESSION['authed_families'], true)) {
            $_SESSION['authed_families'][] = $slug;
        }
        if (!isset($_SESSION['admin_families']) || !is_array($_SESSION['admin_families'])) {
            $_SESSION['admin_families'] = [];
        }
        if ($isAdminPassword && !in_array($slug, $_SESSION['admin_families'], true)) {
            $_SESSION['admin_families'][] = $slug;
        }
        echo json_encode([
            'authed' => true,
            'admin' => $isAdminPassword,
            'canAdmin' => can_admin($family),
        ]);
    } else {
        http_response_code(401);
        echo json_encode(['authed' => false, 'error' => 'Incorrect password.']);
    }
    exit;
}

if ($action === 'logout') {
    // Only signs out of the current family — other families in the same
    // session (if the person is a member of more than one) stay signed in.
    if (!empty($_SESSION['authed_families'])) {
        $_SESSION['authed_families'] = array_values(array_diff($_SESSION['authed_families'], [$slug]));
    }
    if (!empty($_SESSION['admin_families'])) {
        $_SESSION['admin_families'] = array_values(array_diff($_SESSION['admin_families'], [$slug]));
    }
    echo json_encode(['authed' => false, 'admin' => false, 'canAdmin' => false]);
    exit;
}

if ($action === 'status') {
    echo json_encode([
        'authed' => is_authed($slug),
        'admin' => is_admin($slug),
        // Whether this session may do admin-only things right now. True for
        // a plain editor when no admin password is configured.
        'canAdmin' => can_admin($family),
        'adminConfigured' => family_has_admin($family),
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unknown action']);