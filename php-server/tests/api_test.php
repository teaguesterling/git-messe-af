<?php
/**
 * MESS Exchange Server - API Test Suite
 *
 * Run with: php tests/api_test.php [base_url]
 * Default base_url: http://localhost:8080
 */

$baseUrl = $argv[1] ?? 'http://localhost:8080';

class ApiTestSuite
{
    private string $baseUrl;
    private int $passed = 0;
    private int $failed = 0;
    private array $failures = [];
    private ?string $apiKey = null;
    private ?string $executorId = null;
    private ?string $threadRef = null;

    public function __construct(string $baseUrl)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
    }

    // ============ HTTP Helpers ============

    private function request(string $method, string $path, ?array $body = null, ?string $token = null): array
    {
        $ch = curl_init();
        $url = $this->baseUrl . $path;

        $headers = ['Content-Type: application/json'];
        if ($token) {
            $headers[] = "Authorization: Bearer {$token}";
        }

        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_TIMEOUT => 10,
        ]);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        return [
            'status' => $httpCode,
            'body' => $response,
            'data' => json_decode($response, true),
            'error' => $error,
        ];
    }

    private function get(string $path, ?string $token = null): array
    {
        return $this->request('GET', $path, null, $token);
    }

    private function post(string $path, array $body, ?string $token = null): array
    {
        return $this->request('POST', $path, $body, $token);
    }

    private function patch(string $path, array $body, ?string $token = null): array
    {
        return $this->request('PATCH', $path, $body, $token);
    }

    // ============ Assertions ============

    private function assert(bool $condition, string $message): void
    {
        if ($condition) {
            $this->passed++;
            echo "  [PASS] {$message}\n";
        } else {
            $this->failed++;
            $this->failures[] = $message;
            echo "  [FAIL] {$message}\n";
        }
    }

    private function assertEqual($expected, $actual, string $message): void
    {
        $this->assert($expected === $actual, "{$message} (expected: " . json_encode($expected) . ", got: " . json_encode($actual) . ")");
    }

    private function assertStatus(array $response, int $expectedStatus, string $context): void
    {
        $this->assertEqual($expectedStatus, $response['status'], "{$context} - status code");
    }

    private function assertHasKey(array $data, string $key, string $context): void
    {
        $this->assert(isset($data[$key]), "{$context} - has key '{$key}'");
    }

    private function assertNotEmpty($value, string $context): void
    {
        $this->assert(!empty($value), "{$context} - not empty");
    }

    // ============ Test Groups ============

    public function run(): void
    {
        echo "\n=== MESS Exchange Server - API Test Suite ===\n";
        echo "Target: {$this->baseUrl}\n\n";

        $this->testHealth();
        $this->testExecutorRegistration();
        $this->testAuthentication();
        $this->testRequestLifecycle();
        $this->testExecutorManagement();
        $this->testSecurityPathTraversal();
        $this->testSecurityInjection();
        $this->testSecurityAuthentication();
        $this->testSecurityAuthorization();
        $this->testSecurityInputValidation();
        $this->testEdgeCases();

        $this->printSummary();
    }

    // ============ Health Tests ============

    private function testHealth(): void
    {
        echo "--- Health Check ---\n";

        $res = $this->get('/health');
        $this->assertStatus($res, 200, 'GET /health');
        $this->assertHasKey($res['data'], 'status', 'Health response');
        $this->assertEqual('ok', $res['data']['status'] ?? '', 'Health status is ok');
        $this->assertHasKey($res['data'], 'exchange_id', 'Health response');

        echo "\n";
    }

    // ============ Executor Registration Tests ============

    private function testExecutorRegistration(): void
    {
        echo "--- Executor Registration ---\n";

        // Generate unique executor ID for this test run
        $this->executorId = 'test-' . bin2hex(random_bytes(4));

        // Successful registration
        $res = $this->post('/api/v1/exchanges/home/register', [
            'executor_id' => $this->executorId,
            'display_name' => 'Test Executor',
            'capabilities' => ['photo', 'location'],
        ]);
        $this->assertStatus($res, 201, 'POST /register - success');
        $this->assertHasKey($res['data'], 'api_key', 'Registration response');
        $this->assertHasKey($res['data'], 'executor_id', 'Registration response');

        $this->apiKey = $res['data']['api_key'] ?? null;
        $this->assertNotEmpty($this->apiKey, 'API key returned');

        // Duplicate registration should fail
        $res = $this->post('/api/v1/exchanges/home/register', [
            'executor_id' => $this->executorId,
        ]);
        $this->assertStatus($res, 409, 'POST /register - duplicate');

        // Missing executor_id should fail
        $res = $this->post('/api/v1/exchanges/home/register', [
            'display_name' => 'No ID',
        ]);
        $this->assertStatus($res, 400, 'POST /register - missing executor_id');

        echo "\n";
    }

    // ============ Authentication Tests ============

    private function testAuthentication(): void
    {
        echo "--- Authentication ---\n";

        // No token - should fail
        $res = $this->get('/api/v1/exchanges/home/requests');
        $this->assertStatus($res, 401, 'GET /requests - no token');

        // Invalid token - should fail
        $res = $this->get('/api/v1/exchanges/home/requests', 'invalid_token');
        $this->assertStatus($res, 401, 'GET /requests - invalid token');

        // Malformed token - should fail
        $res = $this->get('/api/v1/exchanges/home/requests', 'not_a_mess_token');
        $this->assertStatus($res, 401, 'GET /requests - malformed token');

        // Valid token - should succeed
        $res = $this->get('/api/v1/exchanges/home/requests', $this->apiKey);
        $this->assertStatus($res, 200, 'GET /requests - valid token');

        echo "\n";
    }

    // ============ Request Lifecycle Tests ============

    private function testRequestLifecycle(): void
    {
        echo "--- Request Lifecycle ---\n";

        // Create request
        $res = $this->post('/api/v1/exchanges/home/requests', [
            'intent' => 'Test request from API test suite',
            'priority' => 'normal',
            'context' => ['Running automated tests'],
            'response_hints' => ['text'],
        ], $this->apiKey);
        $this->assertStatus($res, 201, 'POST /requests - create');
        $this->assertHasKey($res['data'], 'ref', 'Create response');
        $this->assertEqual('pending', $res['data']['status'] ?? '', 'Initial status is pending');

        $this->threadRef = $res['data']['ref'] ?? null;
        $this->assertNotEmpty($this->threadRef, 'Thread ref returned');

        // List requests - should include our new request
        $res = $this->get('/api/v1/exchanges/home/requests', $this->apiKey);
        $this->assertStatus($res, 200, 'GET /requests - list');
        $this->assertHasKey($res['data'], 'threads', 'List response');
        $found = false;
        foreach ($res['data']['threads'] ?? [] as $thread) {
            if ($thread['ref'] === $this->threadRef) {
                $found = true;
                break;
            }
        }
        $this->assert($found, 'Created request appears in list');

        // Get specific request
        $res = $this->get("/api/v1/exchanges/home/requests/{$this->threadRef}", $this->apiKey);
        $this->assertStatus($res, 200, 'GET /requests/{ref}');
        $this->assertHasKey($res['data'], 'thread', 'Get response');
        $this->assertEqual($this->threadRef, $res['data']['thread']['ref'] ?? '', 'Correct thread returned');

        // Claim request
        $res = $this->patch("/api/v1/exchanges/home/requests/{$this->threadRef}", [
            'status' => 'claimed',
        ], $this->apiKey);
        $this->assertStatus($res, 200, 'PATCH /requests/{ref} - claim');
        $this->assertEqual('claimed', $res['data']['status'] ?? '', 'Status changed to claimed');

        // Complete request with response
        $res = $this->patch("/api/v1/exchanges/home/requests/{$this->threadRef}", [
            'status' => 'completed',
            'mess' => [
                ['response' => ['re' => $this->threadRef, 'content' => ['Test completed successfully']]],
            ],
        ], $this->apiKey);
        $this->assertStatus($res, 200, 'PATCH /requests/{ref} - complete');
        $this->assertEqual('completed', $res['data']['status'] ?? '', 'Status changed to completed');

        // Verify final state
        $res = $this->get("/api/v1/exchanges/home/requests/{$this->threadRef}", $this->apiKey);
        $this->assertEqual('completed', $res['data']['thread']['status'] ?? '', 'Thread status is completed');

        echo "\n";
    }

    // ============ Executor Management Tests ============

    private function testExecutorManagement(): void
    {
        echo "--- Executor Management ---\n";

        // List executors
        $res = $this->get('/api/v1/exchanges/home/executors', $this->apiKey);
        $this->assertStatus($res, 200, 'GET /executors');
        $this->assertHasKey($res['data'], 'executors', 'List response');

        // Update own profile
        $res = $this->patch("/api/v1/exchanges/home/executors/{$this->executorId}", [
            'display_name' => 'Updated Test Executor',
            'capabilities' => ['photo', 'location', 'audio'],
        ], $this->apiKey);
        $this->assertStatus($res, 200, 'PATCH /executors/{id} - own profile');

        echo "\n";
    }

    // ============ Security: Path Traversal Tests ============

    private function testSecurityPathTraversal(): void
    {
        echo "--- Security: Path Traversal ---\n";

        // Path traversal in thread ref
        $maliciousRefs = [
            '../../../etc/passwd',
            '..%2F..%2F..%2Fetc%2Fpasswd',
            '....//....//....//etc/passwd',
            '2024-01-01-TEST/../../../etc/passwd',
            '2024-01-01-TEST/../../executors/admin',
        ];

        foreach ($maliciousRefs as $ref) {
            $res = $this->get("/api/v1/exchanges/home/requests/{$ref}", $this->apiKey);
            // Accept 400, 401, 403, or 404 - path traversal may be blocked by:
            // - Validation (400), auth failure (401), exchange mismatch (403), or not found (404)
            // URL normalization by web server can transform ../.. paths, causing auth failures
            $this->assert(
                $res['status'] === 400 || $res['status'] === 401 || $res['status'] === 403 || $res['status'] === 404,
                "Path traversal blocked: " . substr($ref, 0, 30)
            );
        }

        // Path traversal in exchange ID
        $res = $this->get('/api/v1/exchanges/../../../etc/passwd/requests', $this->apiKey);
        $this->assert($res['status'] >= 400, 'Path traversal in exchange ID blocked');

        // Path traversal in attachment filename
        $res = $this->get("/api/v1/exchanges/home/requests/{$this->threadRef}/attachments/../../../etc/passwd", $this->apiKey);
        $this->assert(
            $res['status'] === 400 || $res['status'] === 404,
            'Path traversal in attachment filename blocked'
        );

        echo "\n";
    }

    // ============ Security: Injection Tests ============

    private function testSecurityInjection(): void
    {
        echo "--- Security: Injection Attacks ---\n";

        // SQL injection attempts (should be safe since we use filesystem)
        $sqlPayloads = [
            "'; DROP TABLE users; --",
            "1' OR '1'='1",
            "1; SELECT * FROM passwords",
        ];

        foreach ($sqlPayloads as $payload) {
            $res = $this->post('/api/v1/exchanges/home/requests', [
                'intent' => $payload,
            ], $this->apiKey);
            $this->assert(
                $res['status'] === 201 || $res['status'] === 400,
                "SQL injection in intent handled safely"
            );
        }

        // Command injection in executor ID
        $cmdPayloads = [
            '; rm -rf /',
            '$(whoami)',
            '`id`',
            '| cat /etc/passwd',
        ];

        foreach ($cmdPayloads as $payload) {
            $testId = 'cmd-test-' . bin2hex(random_bytes(2));
            $res = $this->post('/api/v1/exchanges/home/register', [
                'executor_id' => $testId . $payload,
            ]);
            $this->assert(
                $res['status'] >= 200 && $res['status'] < 500,
                "Cmd injection handled: " . substr($payload, 0, 15)
            );
        }

        // YAML injection
        $yamlPayloads = [
            "test: !!python/object/apply:os.system ['id']",
            "--- !ruby/object:Gem::Installer\ni: x",
        ];

        foreach ($yamlPayloads as $payload) {
            $res = $this->post('/api/v1/exchanges/home/requests', [
                'intent' => $payload,
            ], $this->apiKey);
            $this->assert(
                $res['status'] === 201 || $res['status'] === 400,
                "YAML injection handled safely"
            );
        }

        // JSON prototype pollution
        $res = $this->post('/api/v1/exchanges/home/requests', [
            'intent' => 'test',
            '__proto__' => ['admin' => true],
            'constructor' => ['prototype' => ['admin' => true]],
        ], $this->apiKey);
        $this->assert($res['status'] < 500, 'Prototype pollution attempt handled');

        echo "\n";
    }

    // ============ Security: Authentication Tests ============

    private function testSecurityAuthentication(): void
    {
        echo "--- Security: Authentication ---\n";

        // Many invalid tokens
        for ($i = 0; $i < 5; $i++) {
            $fakeToken = 'mess_home_' . bin2hex(random_bytes(16));
            $res = $this->get('/api/v1/exchanges/home/requests', $fakeToken);
            $this->assert($res['status'] === 401, "Invalid token rejected ({$i})");
        }

        // Token with wrong exchange
        $res = $this->get('/api/v1/exchanges/other/requests', $this->apiKey);
        $this->assertStatus($res, 403, 'Token for wrong exchange rejected');

        // Token format attacks
        $tokenAttacks = [
            'mess_home_',
            'mess__abc123',
            'mess_home',
            str_repeat('A', 10000),
            "mess_home_abc\x00def",
        ];

        foreach ($tokenAttacks as $token) {
            $res = $this->get('/api/v1/exchanges/home/requests', $token);
            $this->assert($res['status'] === 401, 'Malformed token rejected');
        }

        echo "\n";
    }

    // ============ Security: Authorization Tests ============

    private function testSecurityAuthorization(): void
    {
        echo "--- Security: Authorization ---\n";

        // Register a second executor
        $otherExecutorId = 'other-' . bin2hex(random_bytes(4));
        $res = $this->post('/api/v1/exchanges/home/register', [
            'executor_id' => $otherExecutorId,
        ]);
        $otherApiKey = $res['data']['api_key'] ?? null;

        if ($otherApiKey) {
            // Try to update another executor's profile
            $res = $this->patch("/api/v1/exchanges/home/executors/{$this->executorId}", [
                'display_name' => 'Hacked!',
            ], $otherApiKey);
            $this->assertStatus($res, 403, 'Cannot update other executor profile');

            // Both should be able to read/write threads
            $res = $this->get('/api/v1/exchanges/home/requests', $otherApiKey);
            $this->assertStatus($res, 200, 'Other executor can list requests');
        }

        echo "\n";
    }

    // ============ Security: Input Validation Tests ============

    private function testSecurityInputValidation(): void
    {
        echo "--- Security: Input Validation ---\n";

        // Empty body
        $res = $this->post('/api/v1/exchanges/home/requests', [], $this->apiKey);
        $this->assertStatus($res, 400, 'Empty request body rejected');

        // Missing required fields
        $res = $this->post('/api/v1/exchanges/home/requests', [
            'priority' => 'normal',
        ], $this->apiKey);
        $this->assertStatus($res, 400, 'Missing intent rejected');

        // Very long intent
        $longIntent = str_repeat('A', 100000);
        $res = $this->post('/api/v1/exchanges/home/requests', [
            'intent' => $longIntent,
        ], $this->apiKey);
        $this->assert($res['status'] < 500, 'Very long intent handled');

        // Unicode and special characters
        $unicodeIntent = "Test with emojis and special chars: <>&\"'";
        $res = $this->post('/api/v1/exchanges/home/requests', [
            'intent' => $unicodeIntent,
        ], $this->apiKey);
        $this->assertStatus($res, 201, 'Unicode intent accepted');

        // Invalid JSON
        $ch = curl_init($this->baseUrl . '/api/v1/exchanges/home/requests');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => 'not valid json{{{',
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                "Authorization: Bearer {$this->apiKey}",
            ],
        ]);
        curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $this->assertEqual(400, $status, 'Invalid JSON rejected');

        echo "\n";
    }

    // ============ Edge Cases ============

    private function testEdgeCases(): void
    {
        echo "--- Edge Cases ---\n";

        // Non-existent thread
        $res = $this->get('/api/v1/exchanges/home/requests/9999-99-99-XXXX', $this->apiKey);
        $this->assertStatus($res, 404, 'Non-existent thread returns 404');

        // Non-existent exchange
        $res = $this->get('/api/v1/exchanges/nonexistent/requests', $this->apiKey);
        $this->assertStatus($res, 403, 'Wrong exchange returns 403');

        // OPTIONS request (CORS preflight)
        $ch = curl_init($this->baseUrl . '/api/v1/exchanges/home/requests');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => 'OPTIONS',
        ]);
        curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $this->assertEqual(204, $status, 'OPTIONS returns 204');

        // HEAD request
        $ch = curl_init($this->baseUrl . '/health');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_NOBODY => true,
        ]);
        curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $this->assertEqual(200, $status, 'HEAD /health returns 200');

        // Unknown endpoint (without auth - expects 401 since auth checked first)
        $res = $this->get('/api/v1/exchanges/home/unknown');
        $this->assertStatus($res, 401, 'Unknown endpoint without auth returns 401');

        // Unknown endpoint (with auth - expects 404)
        $res = $this->get('/api/v1/exchanges/home/unknown', $this->apiKey);
        $this->assertStatus($res, 404, 'Unknown endpoint with auth returns 404');

        echo "\n";
    }

    // ============ Summary ============

    private function printSummary(): void
    {
        $total = $this->passed + $this->failed;
        $passRate = $total > 0 ? round(($this->passed / $total) * 100, 1) : 0;

        echo "============================================\n";
        echo "Test Results\n";
        echo "--------------------------------------------\n";
        echo "   Passed: {$this->passed}\n";
        echo "   Failed: {$this->failed}\n";
        echo "   Total:  {$total}\n";
        echo "   Rate:   {$passRate}%\n";
        echo "============================================\n";

        if ($this->failed > 0) {
            echo "\nFailures:\n";
            foreach ($this->failures as $failure) {
                echo "   - {$failure}\n";
            }
            exit(1);
        } else {
            echo "\nAll tests passed!\n";
            exit(0);
        }
    }
}

// Run tests
$suite = new ApiTestSuite($baseUrl);
$suite->run();
