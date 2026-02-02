/**
 * Gmail SMTP notification sender
 * Uses direct TLS connection to smtp.gmail.com
 */
import tls from 'tls';

/**
 * Send notification via Gmail SMTP
 * @param {Object} config - { email?, app_password?, to? }
 * @param {Object} payload - { intent, priority, requestor, ref, wants_photo, context, url }
 */
export async function send(config, payload) {
  const email = config.email || process.env.GMAIL_EMAIL;
  const appPassword = config.app_password || process.env.GMAIL_APP_PASSWORD;
  const to = config.to || email; // Default to self

  if (!email || !appPassword) {
    throw new Error('GMAIL_EMAIL or GMAIL_APP_PASSWORD not set');
  }

  const subject = `[MESS ${payload.priority.toUpperCase()}] ${payload.intent}`;
  const body = [
    `New MESS Request`,
    ``,
    `Intent: ${payload.intent}`,
    `Priority: ${payload.priority}`,
    `From: ${payload.requestor}`,
    `Ref: ${payload.ref}`,
    payload.wants_photo ? `📷 Photo requested` : '',
    payload.context?.length ? `\nContext:\n${payload.context.map(c => `  • ${c}`).join('\n')}` : '',
    ``,
    `View: ${payload.url}`
  ].filter(Boolean).join('\n');

  const message = [
    `From: MESS Exchange <${email}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body
  ].join('\r\n');

  // Simple SMTP send via TLS
  return new Promise((resolve, reject) => {
    const socket = tls.connect(465, 'smtp.gmail.com', () => {
      let step = 0;
      const commands = [
        null, // Wait for greeting
        `EHLO localhost`,
        `AUTH LOGIN`,
        Buffer.from(email).toString('base64'),
        Buffer.from(appPassword).toString('base64'),
        `MAIL FROM:<${email}>`,
        `RCPT TO:<${to}>`,
        `DATA`,
        message + '\r\n.',
        `QUIT`
      ];

      socket.on('data', (data) => {
        const response = data.toString();
        const code = parseInt(response.slice(0, 3));

        if (code >= 400) {
          socket.destroy();
          reject(new Error(`SMTP error: ${response.trim()}`));
          return;
        }

        step++;
        if (step < commands.length && commands[step]) {
          socket.write(commands[step] + '\r\n');
        } else if (step >= commands.length) {
          socket.end();
          resolve({ success: true, to });
        }
      });

      socket.on('error', reject);
    });
  });
}
