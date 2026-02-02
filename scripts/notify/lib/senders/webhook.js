/**
 * Generic webhook notification sender
 */
import { httpRequest, parseUrl } from '../http.js';

/**
 * Send notification via generic webhook
 * @param {Object} config - { url, method?, headers? }
 * @param {Object} payload - Full notification payload
 */
export async function send(config, payload) {
  const parsed = parseUrl(config.url);
  const method = config.method || 'POST';

  const headers = {
    'Content-Type': 'application/json',
    ...(config.headers || {})
  };

  await httpRequest(config.url, {
    method,
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.path,
    headers
  }, JSON.stringify(payload));

  return { success: true, url: config.url };
}
