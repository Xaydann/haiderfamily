<?php
session_start();

$_SESSION['test'] = "Hello";

echo $_SESSION['test'];