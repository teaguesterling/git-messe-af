<?php

namespace MesseAf\Handlers;

use MesseAf\MesseAf;
use MesseAf\Storage;

class Requests
{
    private Storage $storage;

    public function __construct(Storage $storage)
    {
        $this->storage = $storage;
    }

    /**
     * Validate a thread reference to prevent path traversal
     * Valid format: YYYY-MM-DD-XXXX (date + 4 alphanumeric chars)
     */
    private function validateRef(string $ref): bool
    {
        // Reject any path traversal attempts
        if (str_contains($ref, '..') || str_contains($ref, '/') || str_contains($ref, '\\')) {
            return false;
        }

        // Reject null bytes and other control characters
        if (preg_match('/[\x00-\x1f\x7f]/', $ref)) {
            return false;
        }

        // Validate format: YYYY-MM-DD-XXXX
        if (!preg_match('/^\d{4}-\d{2}-\d{2}-[A-Za-z0-9]{3,6}$/', $ref)) {
            return false;
        }

        return true;
    }

    /**
     * List all requests
     * GET /api/v1/exchanges/{id}/requests
     */
    public function list(array $auth, array $query = []): array
    {
        $status = $query['status'] ?? null;
        $threads = $this->storage->listThreads($auth['exchange_id'], $status);

        return [
            'data' => ['threads' => $threads],
            'status' => 200,
        ];
    }

    /**
     * Get a specific request
     * GET /api/v1/exchanges/{id}/requests/{ref}
     */
    public function get(array $auth, string $ref): array
    {
        if (!$this->validateRef($ref)) {
            return ['error' => 'Invalid thread reference', 'status' => 400];
        }

        $thread = $this->storage->getThread($auth['exchange_id'], $ref);

        if ($thread === null) {
            return ['error' => 'Thread not found', 'status' => 404];
        }

        // Build response from thread data
        $envelope = $thread['envelope'];
        $response = [
            'ref' => $envelope['ref'],
            'status' => $envelope['status'],
            'intent' => $envelope['intent'] ?? '',
            'requestor_id' => $envelope['requestor'] ?? '',
            'executor_id' => $envelope['executor'] ?? null,
            'priority' => $envelope['priority'] ?? 'normal',
            'created_at' => $envelope['created'] ?? '',
            'updated_at' => $envelope['updated'] ?? '',
            'messages' => array_map(function ($msg) {
                return [
                    'from' => $msg['from'] ?? 'unknown',
                    'ts' => $msg['received'] ?? '',
                    'mess' => $msg['MESS'] ?? [],
                ];
            }, $thread['messages']),
        ];

        return [
            'data' => ['thread' => $response],
            'status' => 200,
        ];
    }

    /**
     * Create a new request
     * POST /api/v1/exchanges/{id}/requests
     */
    public function create(array $auth, array $body): array
    {
        if (empty($body['intent'])) {
            return ['error' => 'intent required', 'status' => 400];
        }

        $ref = MesseAf::generateRef();
        $intent = $body['intent'];
        $context = $body['context'] ?? [];
        $priority = $body['priority'] ?? 'normal';
        $responseHint = $body['response_hint'] ?? $body['response_hints'] ?? [];

        $envelope = MesseAf::createEnvelope($ref, $auth['id'], $intent, $priority);
        $messages = [
            MesseAf::createRequestMessage($auth['id'], $intent, $context, $responseHint),
            MesseAf::createAckMessage($ref),
        ];

        $this->storage->writeThread($auth['exchange_id'], $envelope, $messages);
        $this->storage->commit("New request: {$ref} - {$intent}");

        return [
            'data' => ['ref' => $ref, 'status' => 'pending'],
            'status' => 201,
        ];
    }

    /**
     * Update a request (status change, add message)
     * PATCH /api/v1/exchanges/{id}/requests/{ref}
     */
    public function update(array $auth, string $ref, array $body): array
    {
        if (!$this->validateRef($ref)) {
            return ['error' => 'Invalid thread reference', 'status' => 400];
        }

        $thread = $this->storage->getThread($auth['exchange_id'], $ref);

        if ($thread === null) {
            return ['error' => 'Thread not found', 'status' => 404];
        }

        $envelope = $thread['envelope'];
        $messages = $thread['messages'];
        $attachments = $thread['attachments'] ?? [];
        $oldFolder = $thread['folder'];
        $oldStatus = $envelope['status'];

        $now = date('c');
        $envelope['updated'] = $now;

        // Handle status change
        if (!empty($body['status']) && $body['status'] !== $oldStatus) {
            $newStatus = $body['status'];
            $envelope['status'] = $newStatus;

            // Set executor on claim
            if ($newStatus === 'claimed' || $newStatus === 'in-progress') {
                $envelope['executor'] = $auth['id'];
            }

            // Add to history
            $envelope['history'][] = [
                'action' => $newStatus,
                'at' => $now,
                'by' => $auth['id'],
            ];

            // Add status message
            $messages[] = MesseAf::createStatusMessage(
                $auth['id'],
                $ref,
                $newStatus,
                $body['message'] ?? null
            );
        }

        // Handle new message
        if (!empty($body['mess'])) {
            $messages[] = [
                'from' => $auth['id'],
                'received' => $now,
                'channel' => 'api',
                'MESS' => $body['mess'],
            ];
        }

        $this->storage->updateThread(
            $auth['exchange_id'],
            $ref,
            $envelope,
            $messages,
            $attachments,
            $oldFolder
        );

        $commitMessage = "Update {$ref}";
        if (!empty($body['status'])) {
            $commitMessage .= ": {$body['status']}";
        }
        $this->storage->commit($commitMessage);

        return [
            'data' => ['ref' => $ref, 'status' => $envelope['status']],
            'status' => 200,
        ];
    }

    /**
     * Get attachment from a thread
     * GET /api/v1/exchanges/{id}/requests/{ref}/attachments/{filename}
     */
    public function getAttachment(array $auth, string $ref, string $filename): array
    {
        if (!$this->validateRef($ref)) {
            return ['error' => 'Invalid thread reference', 'status' => 400];
        }

        // Validate filename to prevent path traversal
        if (str_contains($filename, '..') || str_contains($filename, '/')) {
            return ['error' => 'Invalid filename', 'status' => 400];
        }

        $thread = $this->storage->getThread($auth['exchange_id'], $ref);
        if ($thread === null) {
            return ['error' => 'Thread not found', 'status' => 404];
        }

        // Look for attachment in thread
        foreach ($thread['attachments'] as $att) {
            if ($att['name'] === $filename) {
                return [
                    'data' => ['content' => $att['content'], 'filename' => $filename],
                    'status' => 200,
                ];
            }
        }

        // Try reading from filesystem (v2 format)
        if ($thread['format'] === 'v2') {
            $path = $thread['path'] . '/' . $filename;
            if (file_exists($path)) {
                $content = file_get_contents($path);
                return [
                    'data' => ['content' => base64_encode($content), 'filename' => $filename],
                    'status' => 200,
                ];
            }
        }

        return ['error' => 'Attachment not found', 'status' => 404];
    }
}
