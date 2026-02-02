/**
 * Google Chat webhook notification sender
 */
import { httpRequest, parseUrl } from '../http.js';

/**
 * Send notification via Google Chat webhook
 * @param {Object} config - { webhook_url }
 * @param {Object} payload - { intent, priority, requestor, ref, wants_photo, context, url }
 */
export async function send(config, payload) {
  const webhookUrl = config.webhook_url;
  const parsed = parseUrl(webhookUrl);

  // Google Chat card format
  const message = {
    cardsV2: [{
      cardId: payload.ref,
      card: {
        header: {
          title: `📬 MESS Request`,
          subtitle: payload.priority.toUpperCase(),
          imageUrl: 'https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/mail/default/48px.svg',
          imageType: 'CIRCLE'
        },
        sections: [
          {
            header: payload.intent,
            widgets: [
              {
                decoratedText: {
                  topLabel: 'From',
                  text: payload.requestor
                }
              },
              {
                decoratedText: {
                  topLabel: 'Reference',
                  text: payload.ref
                }
              },
              ...(payload.wants_photo ? [{
                decoratedText: {
                  topLabel: 'Photo',
                  text: '📷 Requested'
                }
              }] : []),
              ...(payload.context?.length ? [{
                decoratedText: {
                  topLabel: 'Context',
                  text: payload.context.join('\n')
                }
              }] : [])
            ]
          },
          {
            widgets: [{
              buttonList: {
                buttons: [{
                  text: 'View Request',
                  onClick: {
                    openLink: { url: payload.url }
                  }
                }]
              }
            }]
          }
        ]
      }
    }]
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
