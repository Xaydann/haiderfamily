<?php
// TEMPORARY HELPER — delete this file from the server once you've used it!
// Visit: yoursite.com/api/generate_hash.php?password=yourChosenPassword
$pwd = $_GET['password'] ?? '';
header('Content-Type: text/plain');
if ($pwd === '') {
    echo "Usage: generate_hash.php?password=yourChosenPassword";
    exit;
}
echo "Your hash (copy this whole string into api/config.php):\n\n";
echo password_hash($pwd, PASSWORD_DEFAULT);
echo "\n\nDelete this file once you've copied the hash!";
