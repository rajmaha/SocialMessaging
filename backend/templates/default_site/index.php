<?php
// Default index.php template for new CloudPanel sites

$db_host = '127.0.0.1';
$db_name = '[db_name]';
$db_user = '[db_user]';
$db_pass = '[db_password]';

echo "<h1>Welcome to your new site!</h1>";
echo "<p>This site was automatically deployed.</p>";

// Optional: Test DB connection
try {
    $dsn = "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4";
    $pdo = new PDO($dsn, $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    echo "<p style='color: green;'>Successfully connected to the database <strong>$db_name</strong> as <strong>$db_user</strong>.</p>";
} catch (PDOException $e) {
    echo "<p style='color: red;'>Database connection failed: " . htmlspecialchars($e->getMessage()) . "</p>";
}
?>
