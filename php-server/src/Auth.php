<?php

namespace MesseAf;

class Auth
{
    /**
     * Extract bearer token from Authorization header
     */
    public static function extractToken(): ?string
    {
        $headers = getallheaders();
        $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';

        // Case-sensitive match for "Bearer" per RFC 6750
        if (preg_match('/^Bearer\s+(.+)$/', $auth, $matches)) {
            return $matches[1];
        }

        return null;
    }

    /**
     * Parse API key to extract exchange ID
     * Format: mess_{exchange}_{random}
     */
    public static function parseApiKey(string $apiKey): array
    {
        $parts = explode('_', $apiKey);
        if (count($parts) < 3 || $parts[0] !== 'mess') {
            return ['valid' => false, 'exchange_id' => null];
        }
        return ['valid' => true, 'exchange_id' => $parts[1]];
    }

    /**
     * Generate new API key for an executor
     */
    public static function generateApiKey(string $exchangeId): string
    {
        $random = bin2hex(random_bytes(16));
        return "mess_{$exchangeId}_{$random}";
    }

    /**
     * Hash API key for secure storage
     */
    public static function hashApiKey(string $apiKey): string
    {
        return base64_encode(hash('sha256', $apiKey, true));
    }

    /**
     * Validate token against stored executors
     * Returns executor info if valid, null otherwise
     */
    public static function authenticate(string $token, Storage $storage): ?array
    {
        $parsed = self::parseApiKey($token);
        if (!$parsed['valid']) {
            return null;
        }

        $exchangeId = $parsed['exchange_id'];
        $keyHash = self::hashApiKey($token);
        $executors = $storage->listExecutors($exchangeId);

        foreach ($executors as $executor) {
            // Use hash_equals for constant-time comparison (prevents timing attacks)
            $storedHash = $executor['api_key_hash'] ?? '';
            if ($storedHash !== '' && hash_equals($storedHash, $keyHash)) {
                return array_merge($executor, ['exchange_id' => $exchangeId]);
            }
        }

        return null;
    }
}
