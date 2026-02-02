/**
 * HTTP utilities for notification senders
 */
import https from 'https';
import http from 'http';

/**
 * Parse URL string into components for http/https request
 */
export function parseUrl(urlString) {
  const url = new URL(urlString);
  return {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    protocol: url.protocol
  };
}

/**
 * Make an HTTP/HTTPS request
 * @param {string} url - Full URL
 * @param {Object} options - Request options (method, headers, etc.)
 * @param {string} [body] - Request body
 * @returns {Promise<{status: number, data: string, json: Object|null}>}
 */
export function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data, json: tryParseJson(data) });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/**
 * Get Google OAuth access token using refresh token
 * @param {Object} credentials - { client_id, client_secret, refresh_token }
 * @returns {Promise<string>} Access token
 */
export async function getGoogleAccessToken({ client_id, client_secret, refresh_token }) {
  const params = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: 'refresh_token'
  });

  const response = await httpRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, params.toString());

  if (!response.json?.access_token) {
    throw new Error('Failed to refresh Google access token');
  }

  return response.json.access_token;
}

/**
 * Expand {{variable}} templates in a string
 */
export function expandTemplate(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return context[key] ?? '';
  });
}
