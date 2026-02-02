/**
 * Slack webhook notification sender
 */
import { httpRequest, parseUrl } from '../http.js';

/**
 * Send notification via Slack webhook
 * @param {Object} config - { webhook_url }
 * @param {Object} payload - { intent, priority, requestor, ref, wants_photo, context, url }
 */
export async function send(config, payload) {
  const webhookUrl = config.webhook_url;
  const parsed = parseUrl(webhookUrl);

  const message = {
    text: `New MESS Request: ${payload.intent}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📬 ${payload.intent}` }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Priority:* ${payload.priority}` },
          { type: 'mrkdwn', text: `*From:* ${payload.requestor}` },
          { type: 'mrkdwn', text: `*Ref:* ${payload.ref}` },
          { type: 'mrkdwn', text: `*Photo:* ${payload.wants_photo ? 'Yes 📷' : 'No'}` }
        ]
      },
      ...(payload.context?.length ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Context:*\n${payload.context.map(c => `• ${c}`).join('\n')}` }
      }] : []),
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'View Request' },
          url: payload.url
        }]
      }
    ]
  };

  await httpRequest(webhookUrl, {
    method: 'POST',
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.path,
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify(message));

  return { success: true };
}
