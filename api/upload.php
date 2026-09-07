<?php
require_once 'config.php';

$family = require_family();
require_auth($family['slug']); // only signed-in family members can upload files

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
// 'image' is kept as the field name for backward compatibility with the
// tree's own photo/gallery uploads, which always send category=image.
$dataUrl = (string)($input['image'] ?? $input['data'] ?? '');
$category = (string)($input['category'] ?? 'image');

// Each category has its own allowed mime types, a size cap chosen to be
// reasonable on free/shared hosting (audio and especially video add up
// fast — these are intentionally conservative), and a safe extension to
// save it under. Never trust a filename from the client for the saved
// file's extension — it's always derived from this fixed lookup instead.
$rules = [
    'image' => [
        'max' => 8 * 1024 * 1024,
        'ext' => ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'],
        'prefix' => 'img',
    ],
    'audio' => [
        'max' => 12 * 1024 * 1024,
        'ext' => ['audio/mpeg' => 'mp3', 'audio/mp3' => 'mp3', 'audio/wav' => 'wav',
                   'audio/x-wav' => 'wav', 'audio/ogg' => 'ogg', 'audio/mp4' => 'm4a',
                   'audio/x-m4a' => 'm4a', 'audio/aac' => 'aac'],
        'prefix' => 'audio',
    ],
    'video' => [
        'max' => 25 * 1024 * 1024,
        'ext' => ['video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/quicktime' => 'mov'],
        'prefix' => 'video',
    ],
    'document' => [
        'max' => 10 * 1024 * 1024,
        'ext' => [
            'application/pdf' => 'pdf',
            'application/msword' => 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
            'application/vnd.ms-excel' => 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
            'application/vnd.ms-powerpoint' => 'ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
            'text/plain' => 'txt',
            'text/csv' => 'csv',
            'application/rtf' => 'rtf',
            // documents can also just be a photo/scan
            'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp',
        ],
        'prefix' => 'doc',
    ],
];

if (!isset($rules[$category])) {
    http_response_code(400);
    echo json_encode(['error' => 'Unknown upload category']);
    exit;
}
$rule = $rules[$category];

if (!preg_match('/^data:([a-zA-Z0-9.+\/-]+);base64,/', $dataUrl, $m)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid file data']);
    exit;
}
$mime = strtolower($m[1]);
if (!isset($rule['ext'][$mime])) {
    http_response_code(400);
    echo json_encode(['error' => 'That file type isn\'t supported for this section.']);
    exit;
}
$ext = $rule['ext'][$mime];

$base64 = substr($dataUrl, strpos($dataUrl, ',') + 1);
$bytes = base64_decode($base64, true);
if ($bytes === false) {
    http_response_code(400);
    echo json_encode(['error' => 'Could not decode file']);
    exit;
}
if (strlen($bytes) > $rule['max']) {
    $maxMb = round($rule['max'] / (1024 * 1024));
    http_response_code(400);
    echo json_encode(['error' => "File too large (max {$maxMb}MB for this section)"]);
    exit;
}

if (!is_dir(UPLOADS_DIR)) {
    @mkdir(UPLOADS_DIR, 0755, true);
}
// Belt-and-braces: make sure the uploads folder can never execute PHP,
// now that it accepts a wider range of file types than just images.
$htaccess = UPLOADS_DIR . '.htaccess';
if (!file_exists($htaccess)) {
    @file_put_contents($htaccess, "php_flag engine off\n<FilesMatch \"\\.(php|phtml|php\\d)$\">\nRequire all denied\n</FilesMatch>\n");
}

$filename = $rule['prefix'] . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
$path = UPLOADS_DIR . $filename;

if (file_put_contents($path, $bytes) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Could not save file — check that uploads/ is writable (permissions 755 or 775).']);
    exit;
}

echo json_encode(['url' => UPLOADS_URL . $filename]);