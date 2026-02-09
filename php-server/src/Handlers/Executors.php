<?php

namespace MesseAf\Handlers;

use MesseAf\Auth;
use MesseAf\Storage;

class Executors
{
    private Storage $storage;

    public function __construct(Storage $storage)
    {
        $this->storage = $storage;
    }

    /**
     * Register a new executor
     * POST /api/v1/exchanges/{id}/register
     */
    public function register(string $exchangeId, array $body): array
    {
        if (empty($body['executor_id'])) {
            return ['error' => 'executor_id required', 'status' => 400];
        }

        $executorId = $body['executor_id'];
        $existing = $this->storage->getExecutor($exchangeId, $executorId);

        if ($existing !== null) {
            return ['error' => 'Executor already registered', 'status' => 409];
        }

        $apiKey = Auth::generateApiKey($exchangeId);
        $keyHash = Auth::hashApiKey($apiKey);

        $executor = [
            'id' => $executorId,
            'display_name' => $body['display_name'] ?? $executorId,
            'capabilities' => $body['capabilities'] ?? [],
            'notifications' => $body['notifications'] ?? [],
            'hooks' => $body['hooks'] ?? [],
            'preferences' => $body['preferences'] ?? [],
            'api_key_hash' => $keyHash,
            'created_at' => date('c'),
            'last_seen' => date('c'),
        ];

        $this->storage->putExecutor($exchangeId, $executor);
        $this->storage->commit("Register executor: {$executorId}");

        return [
            'data' => [
                'executor_id' => $executor['id'],
                'api_key' => $apiKey,
                'message' => 'Save this API key - it cannot be retrieved again.',
            ],
            'status' => 201,
        ];
    }

    /**
     * List all executors
     * GET /api/v1/exchanges/{id}/executors
     */
    public function list(array $auth): array
    {
        $executors = $this->storage->listExecutors($auth['exchange_id']);

        // Return safe subset of executor info (no API key hash)
        $safe = array_map(function ($e) {
            return [
                'id' => $e['id'],
                'display_name' => $e['display_name'] ?? $e['id'],
                'capabilities' => $e['capabilities'] ?? [],
                'last_seen' => $e['last_seen'] ?? null,
                'created_at' => $e['created_at'] ?? null,
            ];
        }, $executors);

        return [
            'data' => ['executors' => $safe],
            'status' => 200,
        ];
    }

    /**
     * Update executor profile
     * PATCH /api/v1/exchanges/{id}/executors/{eid}
     */
    public function update(array $auth, string $executorId, array $body): array
    {
        if ($auth['id'] !== $executorId) {
            return ['error' => 'Can only update your own profile', 'status' => 403];
        }

        $executor = $this->storage->getExecutor($auth['exchange_id'], $executorId);
        if ($executor === null) {
            return ['error' => 'Executor not found', 'status' => 404];
        }

        if (isset($body['display_name'])) {
            $executor['display_name'] = $body['display_name'];
        }
        if (isset($body['capabilities'])) {
            $executor['capabilities'] = $body['capabilities'];
        }
        if (isset($body['notifications'])) {
            $executor['notifications'] = $body['notifications'];
        }
        if (isset($body['hooks'])) {
            $executor['hooks'] = $body['hooks'];
        }
        if (isset($body['preferences'])) {
            $executor['preferences'] = $body['preferences'];
        }
        $executor['last_seen'] = date('c');

        $this->storage->putExecutor($auth['exchange_id'], $executor);
        $this->storage->commit("Update executor: {$executorId}");

        return [
            'data' => ['executor_id' => $executor['id'], 'updated' => true],
            'status' => 200,
        ];
    }
}
