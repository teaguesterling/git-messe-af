<?php

namespace MesseAf;

class Config
{
    private static ?array $config = null;

    public static function load(): array
    {
        if (self::$config !== null) {
            return self::$config;
        }

        $configPath = __DIR__ . '/../config.php';
        if (!file_exists($configPath)) {
            $configPath = __DIR__ . '/../config.example.php';
        }

        self::$config = require $configPath;
        return self::$config;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $config = self::load();
        return $config[$key] ?? $default;
    }

    public static function getDataPath(): string
    {
        return self::get('data_path', __DIR__ . '/../data');
    }

    public static function getExchangeId(): string
    {
        return self::get('exchange_id', 'home');
    }

    public static function isGitEnabled(): bool
    {
        return self::get('git_enabled', true);
    }

    public static function shouldGitPush(): bool
    {
        return self::get('git_push', false);
    }
}
