/**
 * ntfy.sh notification sender
 * https://ntfy.sh/
 */
import { httpRequest, parseUrl } from '../http.js';

/**
 * Send notification via ntfy
 * @param {Object} config - { server?, topic }
 * @param {Object} payload - { intent, priority, requestor, ref, wants_photo, url }
 */
export async function send(config, payload) {
  const server = config.server || 'https://ntfy.sh';
  const url = `${server}/${config.topic}`;
  const priority = { background: '2', normal: '3', elevated: '4', urgent: '5' }[payload.priority] || '3';

  const parsed = parseUrl(url);
  await httpRequest(url, {
    method: 'POST',
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.path,
    headers: {
      'Content-Type': 'text/plain',
      'Title': `MESS: ${payload.intent}`,
      'Priority': priority,
      'Tags': payload.wants_photo ? 'camera,incoming_envelope' : 'incoming_envelope',
      'Click': payload.url
    }
  }, `${payload.priority.toUpperCase()}: ${payload.intent}\nFrom: ${payload.requestor}\nRef: ${payload.ref}`);

  return { success: true, topic: config.topic };
}
