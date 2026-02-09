<?php

namespace MesseAf;

/**
 * Git-backed filesystem storage for MESSE-AF threads
 */
class Storage
{
    private string $basePath;
    private bool $gitEnabled;
    private bool $gitPush;

    public function __construct(string $basePath, bool $gitEnabled = true, bool $gitPush = false)
    {
        $this->basePath = rtrim($basePath, '/');
        $this->gitEnabled = $gitEnabled;
        $this->gitPush = $gitPush;

        // Ensure base directories exist
        $this->ensureDir($this->basePath . '/exchange');
        $this->ensureDir($this->basePath . '/executors');
        foreach (['received', 'executing', 'finished', 'canceled'] as $folder) {
            $this->ensureDir($this->basePath . "/exchange/state={$folder}");
        }
    }

    // ============ Executor Operations ============

    public function getExecutor(string $exchangeId, string $executorId): ?array
    {
        $path = $this->basePath . "/executors/exchange={$exchangeId}/{$executorId}.json";
        if (!file_exists($path)) {
            return null;
        }
        return json_decode(file_get_contents($path), true);
    }

    public function putExecutor(string $exchangeId, array $executor): void
    {
        $dir = $this->basePath . "/executors/exchange={$exchangeId}";
        $this->ensureDir($dir);
        $path = "{$dir}/{$executor['id']}.json";
        file_put_contents($path, json_encode($executor, JSON_PRETTY_PRINT));
    }

    public function listExecutors(string $exchangeId): array
    {
        $dir = $this->basePath . "/executors/exchange={$exchangeId}";
        if (!is_dir($dir)) {
            return [];
        }

        $executors = [];
        foreach (glob("{$dir}/*.json") as $file) {
            $data = json_decode(file_get_contents($file), true);
            if ($data) {
                $executors[] = $data;
            }
        }
        return $executors;
    }

    // ============ Thread Operations ============

    /**
     * List all threads for an exchange, optionally filtered by status
     */
    public function listThreads(string $exchangeId, ?string $status = null): array
    {
        $folders = $status !== null
            ? [MesseAf::getFolderForStatus($status)]
            : ['received', 'executing', 'finished', 'canceled'];

        $threads = [];
        $seen = [];

        foreach ($folders as $folder) {
            $basePath = $this->basePath . "/exchange/state={$folder}";
            if (!is_dir($basePath)) {
                continue;
            }

            foreach (scandir($basePath) as $entry) {
                if ($entry === '.' || $entry === '..') {
                    continue;
                }

                $entryPath = "{$basePath}/{$entry}";

                // v2 format: directory
                if (is_dir($entryPath)) {
                    $ref = $entry;
                    if (isset($seen[$ref])) {
                        continue;
                    }
                    $seen[$ref] = true;

                    $thread = $this->getThread($exchangeId, $ref);
                    if ($thread) {
                        $threads[] = $this->threadToSummary($thread);
                    }
                }
                // v1 format: .messe-af.yaml file
                elseif (str_ends_with($entry, '.messe-af.yaml')) {
                    $ref = str_replace('.messe-af.yaml', '', $entry);
                    if (isset($seen[$ref])) {
                        continue;
                    }
                    $seen[$ref] = true;

                    $thread = $this->getThread($exchangeId, $ref);
                    if ($thread) {
                        $threads[] = $this->threadToSummary($thread);
                    }
                }
            }
        }

        // Sort by updated time, newest first
        usort($threads, fn($a, $b) => strcmp($b['updated_at'], $a['updated_at']));

        return $threads;
    }

    /**
     * Get a thread by reference
     */
    public function getThread(string $exchangeId, string $ref): ?array
    {
        foreach (['received', 'executing', 'finished', 'canceled'] as $folder) {
            $basePath = $this->basePath . "/exchange/state={$folder}";

            // Check for v2 directory format
            $dirPath = "{$basePath}/{$ref}";
            if (is_dir($dirPath)) {
                $files = [];
                foreach (scandir($dirPath) as $file) {
                    if ($file === '.' || $file === '..') {
                        continue;
                    }
                    $files[] = [
                        'name' => $file,
                        'content' => file_get_contents("{$dirPath}/{$file}"),
                    ];
                }
                if (!empty($files)) {
                    $parsed = MesseAf::parseThread($files);
                    return array_merge($parsed, [
                        'folder' => $folder,
                        'format' => 'v2',
                        'path' => $dirPath,
                    ]);
                }
            }

            // Check for v1 flat file format
            $filePath = "{$basePath}/{$ref}.messe-af.yaml";
            if (file_exists($filePath)) {
                $content = file_get_contents($filePath);
                $parsed = MesseAf::parseThreadV1($content);
                return array_merge($parsed, [
                    'folder' => $folder,
                    'format' => 'v1',
                    'path' => $filePath,
                ]);
            }
        }

        return null;
    }

    /**
     * Write a new thread
     */
    public function writeThread(string $exchangeId, array $envelope, array $messages, array $attachments = []): void
    {
        $folder = MesseAf::getFolderForStatus($envelope['status']);
        $basePath = $this->basePath . "/exchange/state={$folder}";
        $ref = $envelope['ref'];

        // Always use v2 format for new threads
        $dirPath = "{$basePath}/{$ref}";
        $this->ensureDir($dirPath);

        $files = MesseAf::serializeThread($envelope, $messages, $attachments);

        foreach ($files as $file) {
            $filePath = "{$dirPath}/{$file['name']}";
            if (!empty($file['binary'])) {
                file_put_contents($filePath, base64_decode($file['content']));
            } else {
                file_put_contents($filePath, $file['content']);
            }
        }
    }

    /**
     * Update an existing thread (add message, change status, etc.)
     */
    public function updateThread(
        string $exchangeId,
        string $ref,
        array $envelope,
        array $messages,
        array $attachments = [],
        ?string $oldFolder = null
    ): void {
        $newFolder = MesseAf::getFolderForStatus($envelope['status']);
        $basePath = $this->basePath . "/exchange/state={$newFolder}";
        $dirPath = "{$basePath}/{$ref}";

        $this->ensureDir($dirPath);

        $files = MesseAf::serializeThread($envelope, $messages, $attachments);

        foreach ($files as $file) {
            $filePath = "{$dirPath}/{$file['name']}";
            if (!empty($file['binary'])) {
                file_put_contents($filePath, base64_decode($file['content']));
            } else {
                file_put_contents($filePath, $file['content']);
            }
        }

        // If folder changed, delete from old location
        if ($oldFolder !== null && $oldFolder !== $newFolder) {
            $oldBasePath = $this->basePath . "/exchange/state={$oldFolder}";
            $oldDirPath = "{$oldBasePath}/{$ref}";

            if (is_dir($oldDirPath)) {
                $this->deleteDir($oldDirPath);
            }

            $oldFilePath = "{$oldBasePath}/{$ref}.messe-af.yaml";
            if (file_exists($oldFilePath)) {
                unlink($oldFilePath);
            }
        }
    }

    // ============ Git Operations ============

    /**
     * Commit changes with a message
     * Uses proc_open for secure command execution
     */
    public function commit(string $message): bool
    {
        if (!$this->gitEnabled) {
            return false;
        }

        $cwd = getcwd();
        chdir($this->basePath);

        // Stage all changes
        $descriptorspec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $process = proc_open(['git', 'add', '-A'], $descriptorspec, $pipes, $this->basePath);
        if (!is_resource($process)) {
            chdir($cwd);
            return false;
        }
        fclose($pipes[0]);
        stream_get_contents($pipes[1]);
        stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $returnCode = proc_close($process);

        if ($returnCode !== 0) {
            chdir($cwd);
            return false;
        }

        // Check if there are changes to commit
        $process = proc_open(['git', 'diff', '--cached', '--quiet'], $descriptorspec, $pipes, $this->basePath);
        if (!is_resource($process)) {
            chdir($cwd);
            return false;
        }
        fclose($pipes[0]);
        stream_get_contents($pipes[1]);
        stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $returnCode = proc_close($process);

        if ($returnCode === 0) {
            // No changes to commit
            chdir($cwd);
            return true;
        }

        // Create commit
        $process = proc_open(['git', 'commit', '-m', $message], $descriptorspec, $pipes, $this->basePath);
        if (!is_resource($process)) {
            chdir($cwd);
            return false;
        }
        fclose($pipes[0]);
        stream_get_contents($pipes[1]);
        stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $returnCode = proc_close($process);

        if ($returnCode === 0 && $this->gitPush) {
            $process = proc_open(['git', 'push'], $descriptorspec, $pipes, $this->basePath);
            if (is_resource($process)) {
                fclose($pipes[0]);
                stream_get_contents($pipes[1]);
                stream_get_contents($pipes[2]);
                fclose($pipes[1]);
                fclose($pipes[2]);
                proc_close($process);
            }
        }

        chdir($cwd);
        return $returnCode === 0;
    }

    // ============ Helpers ============

    private function threadToSummary(array $thread): array
    {
        $envelope = $thread['envelope'];
        return [
            'ref' => $envelope['ref'],
            'status' => $envelope['status'],
            'intent' => $envelope['intent'] ?? '',
            'requestor_id' => $envelope['requestor'] ?? '',
            'executor_id' => $envelope['executor'] ?? null,
            'priority' => $envelope['priority'] ?? 'normal',
            'created_at' => $envelope['created'] ?? '',
            'updated_at' => $envelope['updated'] ?? '',
        ];
    }

    private function ensureDir(string $path): void
    {
        if (!is_dir($path)) {
            mkdir($path, 0755, true);
        }
    }

    private function deleteDir(string $path): void
    {
        if (!is_dir($path)) {
            return;
        }

        foreach (scandir($path) as $file) {
            if ($file === '.' || $file === '..') {
                continue;
            }
            $filePath = "{$path}/{$file}";
            if (is_dir($filePath)) {
                $this->deleteDir($filePath);
            } else {
                unlink($filePath);
            }
        }
        rmdir($path);
    }
}
