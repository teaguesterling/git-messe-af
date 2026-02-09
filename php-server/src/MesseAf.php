<?php

namespace MesseAf;

use Symfony\Component\Yaml\Yaml;

/**
 * MESSE-AF format parser and serializer
 */
class MesseAf
{
    public const STATUS_FOLDERS = [
        'pending' => 'received',
        'claimed' => 'executing',
        'in-progress' => 'executing',
        'needs-input' => 'executing',
        'completed' => 'finished',
        'rejected' => 'canceled',
        'cancelled' => 'canceled',
        'expired' => 'canceled',
    ];

    public const VALID_PRIORITIES = ['background', 'normal', 'elevated', 'urgent'];

    /**
     * Validate a status value
     */
    public static function isValidStatus(string $status): bool
    {
        return isset(self::STATUS_FOLDERS[$status]);
    }

    /**
     * Validate a priority value
     */
    public static function isValidPriority(string $priority): bool
    {
        return in_array($priority, self::VALID_PRIORITIES, true);
    }

    /**
     * Validate an exchange ID (alphanumeric with hyphens, 1-64 chars)
     */
    public static function isValidExchangeId(string $id): bool
    {
        if (strlen($id) < 1 || strlen($id) > 64) {
            return false;
        }
        // Must be alphanumeric with hyphens/underscores, no path traversal
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/', $id)) {
            return false;
        }
        return true;
    }

    /**
     * Validate an executor ID (alphanumeric with hyphens, 1-64 chars)
     */
    public static function isValidExecutorId(string $id): bool
    {
        if (strlen($id) < 1 || strlen($id) > 64) {
            return false;
        }
        // Must be alphanumeric with hyphens/underscores, no path traversal
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/', $id)) {
            return false;
        }
        return true;
    }

    /**
     * Check if a string contains control characters (null bytes, etc.)
     * Returns true if the string is safe (no control chars except newlines/tabs)
     */
    public static function isCleanString(string $str): bool
    {
        // Reject null bytes and most control characters
        // Allow \t (0x09), \n (0x0A), \r (0x0D) for formatted text
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $str)) {
            return false;
        }
        return true;
    }

    /**
     * Sanitize a string by removing control characters
     */
    public static function sanitizeString(string $str): string
    {
        // Remove null bytes and other dangerous control characters
        // Preserve \t, \n, \r for formatted text
        return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $str);
    }

    /**
     * Generate a new thread reference
     * Format: YYYY-MM-DD-XXXX (4 random alphanumeric)
     */
    public static function generateRef(): string
    {
        $date = date('Y-m-d');
        $seq = strtoupper(substr(bin2hex(random_bytes(2)), 0, 4));
        return "{$date}-{$seq}";
    }

    /**
     * Get folder name for a given status
     */
    public static function getFolderForStatus(string $status): string
    {
        return self::STATUS_FOLDERS[$status] ?? 'received';
    }

    /**
     * Parse multi-document YAML string
     */
    public static function parseYamlDocs(string $content): array
    {
        $docs = preg_split('/^---$/m', $content);
        $result = [];

        foreach ($docs as $doc) {
            $doc = trim($doc);
            if ($doc !== '') {
                $result[] = Yaml::parse($doc);
            }
        }

        return $result;
    }

    /**
     * Parse thread from v1 flat file format
     */
    public static function parseThreadV1(string $content): array
    {
        $docs = self::parseYamlDocs($content);
        return [
            'envelope' => $docs[0] ?? [],
            'messages' => array_slice($docs, 1),
            'attachments' => [],
        ];
    }

    /**
     * Parse thread from v2 directory format
     * @param array $files Array of ['name' => string, 'content' => string]
     */
    public static function parseThread(array $files): array
    {
        // Sort YAML files by numeric prefix
        $yamlFiles = array_filter($files, fn($f) => str_ends_with($f['name'], '.messe-af.yaml'));
        usort($yamlFiles, function ($a, $b) {
            $numA = (int)explode('-', $a['name'])[0];
            $numB = (int)explode('-', $b['name'])[0];
            return $numA - $numB;
        });

        if (empty($yamlFiles)) {
            throw new \RuntimeException('No YAML files found in thread directory');
        }

        // Parse first file for envelope
        $firstDocs = self::parseYamlDocs($yamlFiles[0]['content']);
        $envelope = $firstDocs[0] ?? [];
        $messages = array_slice($firstDocs, 1);

        // Parse remaining files for additional messages
        for ($i = 1; $i < count($yamlFiles); $i++) {
            $docs = self::parseYamlDocs($yamlFiles[$i]['content']);
            $messages = array_merge($messages, $docs);
        }

        // Collect attachments
        $attachments = array_filter($files, fn($f) => str_starts_with($f['name'], 'att-'));

        return [
            'envelope' => $envelope,
            'messages' => $messages,
            'attachments' => $attachments,
        ];
    }

    /**
     * Serialize thread to v1 flat file format
     */
    public static function serializeThreadV1(array $envelope, array $messages): string
    {
        $docs = array_merge([$envelope], $messages);
        $parts = array_map(fn($d) => Yaml::dump($d, 10, 2), $docs);
        return implode("---\n", $parts);
    }

    /**
     * Serialize thread to v2 directory format
     * @return array Array of ['name' => string, 'content' => string, 'binary' => bool]
     */
    public static function serializeThread(array $envelope, array $messages, array $existingAttachments = []): array
    {
        $files = [];
        $ref = $envelope['ref'];

        // Create main file with envelope and messages
        $docs = array_merge([$envelope], $messages);
        $parts = array_map(fn($d) => Yaml::dump($d, 10, 2), $docs);
        $content = implode("---\n", $parts);

        $files[] = [
            'name' => "000-{$ref}.messe-af.yaml",
            'content' => $content,
            'binary' => false,
        ];

        // Add existing attachments
        foreach ($existingAttachments as $att) {
            $files[] = $att;
        }

        return $files;
    }

    /**
     * Create initial envelope for a new thread
     */
    public static function createEnvelope(
        string $ref,
        string $requestorId,
        string $intent,
        string $priority = 'normal'
    ): array {
        $now = date('c');
        return [
            'ref' => $ref,
            'requestor' => $requestorId,
            'executor' => null,
            'status' => 'pending',
            'created' => $now,
            'updated' => $now,
            'intent' => $intent,
            'priority' => $priority,
            'history' => [
                ['action' => 'created', 'at' => $now, 'by' => $requestorId],
            ],
        ];
    }

    /**
     * Create initial request message
     */
    public static function createRequestMessage(
        string $requestorId,
        string $intent,
        array $context = [],
        array $responseHint = []
    ): array {
        return [
            'from' => $requestorId,
            'received' => date('c'),
            'channel' => 'api',
            'MESS' => [
                ['v' => '1.0.0'],
                [
                    'request' => [
                        'intent' => $intent,
                        'context' => $context,
                        'response_hint' => $responseHint,
                    ],
                ],
            ],
        ];
    }

    /**
     * Create acknowledgment message
     */
    public static function createAckMessage(string $ref): array
    {
        return [
            'from' => 'exchange',
            'received' => date('c'),
            'MESS' => [
                ['ack' => ['re' => 'last', 'ref' => $ref]],
            ],
        ];
    }

    /**
     * Create status change message
     */
    public static function createStatusMessage(string $actorId, string $ref, string $status, ?string $message = null): array
    {
        $mess = [
            'status' => [
                're' => $ref,
                'code' => $status,
            ],
        ];

        if ($message !== null) {
            $mess['status']['message'] = $message;
        }

        return [
            'from' => $actorId,
            'received' => date('c'),
            'channel' => 'api',
            'MESS' => [$mess],
        ];
    }
}
