<?php
/**
 * MESS Exchange Server - PHP Entry Point
 *
 * Handles routing, CORS, authentication, and serves static files.
 */

require_once __DIR__ . '/../vendor/autoload.php';

use MesseAf\Auth;
use MesseAf\Config;
use MesseAf\MesseAf;
use MesseAf\Storage;
use MesseAf\Handlers\Health;
use MesseAf\Handlers\Executors;
use MesseAf\Handlers\Requests;

// ============ Security Headers ============

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

// ============ CORS Headers ============

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ============ Helpers ============

function jsonResponse(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

function errorResponse(string $message, int $status = 400): void
{
    jsonResponse(['error' => $message], $status);
}

function getJsonBody(): array
{
    $input = file_get_contents('php://input');
    if (empty($input)) {
        return [];
    }
    $data = json_decode($input, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        errorResponse('Invalid JSON body', 400);
    }
    return $data ?? [];
}

function getQueryParams(): array
{
    return $_GET;
}

function requireAuth(Storage $storage): array
{
    $token = Auth::extractToken();
    if ($token === null) {
        errorResponse('Authorization required', 401);
    }

    $auth = Auth::authenticate($token, $storage);
    if ($auth === null) {
        errorResponse('Invalid token', 401);
    }

    return $auth;
}

// ============ Static File Serving ============

function serveStaticFile(string $path): void
{
    // Resolve the client directory path
    $clientDir = realpath(__DIR__ . '/../../client');
    if ($clientDir === false) {
        errorResponse('Client directory not found', 500);
    }

    // Normalize the requested path
    $requestedFile = $clientDir . '/' . ltrim($path, '/');
    $realPath = realpath($requestedFile);

    // Security check: ensure the resolved path is within client directory
    if ($realPath === false || !str_starts_with($realPath, $clientDir)) {
        errorResponse('Not found', 404);
    }

    // If it's a directory, serve index.html
    if (is_dir($realPath)) {
        $realPath = $realPath . '/index.html';
        if (!file_exists($realPath)) {
            errorResponse('Not found', 404);
        }
    }

    // Determine content type
    $extension = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
    $mimeTypes = [
        'html' => 'text/html; charset=utf-8',
        'css' => 'text/css',
        'js' => 'application/javascript',
        'json' => 'application/json',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
        'webp' => 'image/webp',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'ttf' => 'font/ttf',
    ];

    $contentType = $mimeTypes[$extension] ?? 'application/octet-stream';

    header("Content-Type: {$contentType}");
    header('Cache-Control: public, max-age=3600');
    readfile($realPath);
    exit;
}

// ============ Routing ============

$method = $_SERVER['REQUEST_METHOD'];
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Remove trailing slash (except for root)
if ($uri !== '/' && str_ends_with($uri, '/')) {
    $uri = rtrim($uri, '/');
}

// Initialize storage
$storage = new Storage(
    Config::getDataPath(),
    Config::isGitEnabled(),
    Config::shouldGitPush()
);

// Route: Health check (supports GET and HEAD)
if ($uri === '/health' && ($method === 'GET' || $method === 'HEAD')) {
    $result = Health::check();
    jsonResponse($result['data'], $result['status']);
}

// Route: API endpoints
if (preg_match('#^/api/v1/exchanges/([^/]+)(.*)$#', $uri, $matches)) {
    $exchangeId = $matches[1];
    $path = $matches[2] ?: '';

    // Validate exchange ID format early to prevent path traversal
    if (!MesseAf::isValidExchangeId($exchangeId)) {
        errorResponse('Invalid exchange ID', 400);
    }

    $executorsHandler = new Executors($storage);
    $requestsHandler = new Requests($storage);

    // Public endpoint: Register executor
    if ($path === '/register' && $method === 'POST') {
        $body = getJsonBody();
        $result = $executorsHandler->register($exchangeId, $body);
        if (isset($result['error'])) {
            errorResponse($result['error'], $result['status']);
        }
        jsonResponse($result['data'], $result['status']);
    }

    // All other endpoints require authentication
    $auth = requireAuth($storage);

    // Verify exchange ID matches token
    if ($auth['exchange_id'] !== $exchangeId) {
        errorResponse('Access denied to this exchange', 403);
    }

    // Route: List requests
    if ($path === '/requests' && $method === 'GET') {
        $result = $requestsHandler->list($auth, getQueryParams());
        jsonResponse($result['data'], $result['status']);
    }

    // Route: Create request
    if ($path === '/requests' && $method === 'POST') {
        $body = getJsonBody();
        $result = $requestsHandler->create($auth, $body);
        if (isset($result['error'])) {
            errorResponse($result['error'], $result['status']);
        }
        jsonResponse($result['data'], $result['status']);
    }

    // Route: Get specific request
    if (preg_match('#^/requests/([^/]+)$#', $path, $refMatch) && $method === 'GET') {
        $ref = $refMatch[1];
        $result = $requestsHandler->get($auth, $ref);
        if (isset($result['error'])) {
            errorResponse($result['error'], $result['status']);
        }
        jsonResponse($result['data'], $result['status']);
    }

    // Route: Update request
    if (preg_match('#^/requests/([^/]+)$#', $path, $refMatch) && $method === 'PATCH') {
        $ref = $refMatch[1];
        $body = getJsonBody();
        $result = $requestsHandler->update($auth, $ref, $body);
        if (isset($result['error'])) {
            errorResponse($result['error'], $result['status']);
        }
        jsonResponse($result['data'], $result['status']);
    }

    // Route: Get attachment
    if (preg_match('#^/requests/([^/]+)/attachments/(.+)$#', $path, $attMatch) && $method === 'GET') {
        $ref = $attMatch[1];
        $filename = $attMatch[2];
        $result = $requestsHandler->getAttachment($auth, $ref, $filename);
        if (isset($result['error'])) {
            errorResponse($result['error'], $result['status']);
        }
        // Return binary content for attachments
        // Sanitize filename for Content-Disposition header
        $safeFilename = preg_replace('/[^a-zA-Z0-9._-]/', '_', $filename);
        header('Content-Type: application/octet-stream');
        header("Content-Disposition: attachment; filename=\"{$safeFilename}\"");
        echo base64_decode($result['data']['content']);
        exit;
    }

    // Route: List executors
    if ($path === '/executors' && $method === 'GET') {
        $result = $executorsHandler->list($auth);
        jsonResponse($result['data'], $result['status']);
    }

    // Route: Update executor
    if (preg_match('#^/executors/([^/]+)$#', $path, $execMatch) && $method === 'PATCH') {
        $executorId = $execMatch[1];
        $body = getJsonBody();
        $result = $executorsHandler->update($auth, $executorId, $body);
        if (isset($result['error'])) {
            errorResponse($result['error'], $result['status']);
        }
        jsonResponse($result['data'], $result['status']);
    }

    // Unknown API endpoint
    errorResponse('Not found', 404);
}

// Route: Client static files
if ($uri === '/client' || str_starts_with($uri, '/client/')) {
    $path = substr($uri, 7) ?: '/';  // Remove '/client' prefix
    serveStaticFile($path);
}

// Route: Root - redirect to client
if ($uri === '/') {
    header('Location: /client/');
    exit;
}

// Not found
errorResponse('Not found', 404);
