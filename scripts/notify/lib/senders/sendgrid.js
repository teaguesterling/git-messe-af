/**
 * SendGrid email notification sender
 * https://sendgrid.com/
 */
import { httpRequest } from '../http.js';

/**
 * Send notification via SendGrid
 * @param {Object} config - { address }
 * @param {Object} payload - { intent, priority, requestor, ref, wants_photo, context, url }
 */
export async function send(config, payload) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    throw new Error('SENDGRID_API_KEY or SENDGRID_FROM_EMAIL not set');
  }

  const message = {
    personalizations: [{ to: [{ email: config.address }] }],
    from: { email: fromEmail, name: 'MESS Exchange' },
    subject: `[MESS ${payload.priority.toUpperCase()}] ${payload.intent}`,
    content: [{
      type: 'text/html',
      value: `
        <h2>📬 New MESS Request</h2>
        <p><strong>Intent:</strong> ${payload.intent}</p>
        <p><strong>Priority:</strong> ${payload.priority}</p>
        <p><strong>From:</strong> ${payload.requestor}</p>
        <p><strong>Ref:</strong> ${payload.ref}</p>
        ${payload.wants_photo ? '<p>📷 <em>Photo requested</em></p>' : ''}
        ${payload.context?.length ? `<p><strong>Context:</strong></p><ul>${payload.context.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}
        <p><a href="${payload.url}">View Request →</a></p>
      `
    }]
  };

  await httpRequest('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    hostname: 'api.sendgrid.com',
    path: '/v3/mail/send',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  }, JSON.stringify(message));

  return { success: true, to: config.address };
}
