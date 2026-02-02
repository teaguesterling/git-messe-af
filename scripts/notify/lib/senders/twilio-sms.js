/**
 * Twilio SMS notification sender
 * https://www.twilio.com/
 */
import { httpRequest } from '../http.js';

/**
 * Send notification via Twilio SMS
 * @param {Object} config - { phone }
 * @param {Object} payload - { intent, priority, requestor, ref }
 */
export async function send(config, payload) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio credentials not set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)');
  }

  const message = `MESS [${payload.priority.toUpperCase()}]: ${payload.intent}\nFrom: ${payload.requestor}\nRef: ${payload.ref}`;

  const params = new URLSearchParams({
    To: config.phone,
    From: fromNumber,
    Body: message
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  await httpRequest(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${auth}`
    }
  }, params.toString());

  return { success: true, to: config.phone };
}
