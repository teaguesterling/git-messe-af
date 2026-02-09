<?php
/**
 * MESS Exchange Server Configuration
 * Copy to config.php and customize
 */

return [
    // Exchange identifier
    'exchange_id' => 'home',

    // Path to git repository for data storage
    'data_path' => __DIR__ . '/data',

    // Enable git commits after writes
    'git_enabled' => true,

    // Auto-push to remote after commits
    'git_push' => false,

    // Optional: pre-configured tokens (leave empty to use executor registration)
    // Format: 'token' => ['exchange' => 'home', 'executor' => 'executor_id']
    'tokens' => [],
];
