/**
 * Pushover notification sender
 * https://pushover.net/
 */
import { httpRequest } from '../http.js';

/**
 * Send notification via Pushover
 * @param {Object} config - { user_key }
 * @param {Object} payload - { intent, priority, requestor, ref, context, url }
 */
export async function send(config, payload) {
  const appToken = process.env.PUSHOVER_APP_TOKEN;
  if (!appToken) {
    throw new Error('PUSHOVER_APP_TOKEN not set');
  }

  const priority = { background: '-1', normal: '0', elevated: '1', urgent: '2' }[payload.priority] || '0';

  const params = new URLSearchParams({
    token: appToken,
    user: config.user_key,
    title: `MESS: ${payload.intent}`,
    message: `From: ${payload.requestor}\nRef: ${payload.ref}${payload.context?.length ? '\n\n' + payload.context.join('\n') : ''}`,
    priority: priority,
    url: payload.url,
    url_title: 'View Request'
  });

  // Urgent priority requires retry/expire
  if (priority === '2') {
    params.append('retry', '60');
    params.append('expire', '3600');
  }

  await httpRequest('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    hostname: 'api.pushover.net',
    path: '/1/messages.json',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, params.toString());

  return { success: true, user_key: config.user_key.slice(0, 8) + '...' };
}
