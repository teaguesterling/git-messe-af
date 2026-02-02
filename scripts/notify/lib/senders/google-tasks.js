/**
 * Google Tasks notification sender
 * Creates tasks in Google Tasks via OAuth API
 */
import { httpRequest, getGoogleAccessToken, expandTemplate } from '../http.js';

/**
 * Send notification via Google Tasks
 * @param {Object} config - { client_id, client_secret, refresh_token, tasklist?, action?, title?, notes?, due?, task_id? }
 * @param {Object} payload - { intent, priority, requestor, ref, url }
 */
export async function send(config, payload) {
  // Support credentials from config or environment
  const clientId = config.client_id || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.client_secret || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = config.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Tasks requires client_id, client_secret, and refresh_token');
  }

  const accessToken = await getGoogleAccessToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });

  const tasklist = config.tasklist || '@default';
  const action = config.action || 'create';

  if (action === 'create') {
    const title = config.title
      ? expandTemplate(config.title, payload)
      : `MESS: ${payload.intent}`;

    const notes = config.notes
      ? expandTemplate(config.notes, payload)
      : `Ref: ${payload.ref}\nPriority: ${payload.priority}\nFrom: ${payload.requestor}\n\nView: ${payload.url}`;

    const body = { title, notes };

    if (config.due) {
      body.due = expandTemplate(config.due, payload);
    }

    const response = await httpRequest(
      `https://tasks.googleapis.com/tasks/v1/lists/${tasklist}/tasks`,
      {
        method: 'POST',
        hostname: 'tasks.googleapis.com',
        path: `/tasks/v1/lists/${tasklist}/tasks`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      },
      JSON.stringify(body)
    );

    return {
      success: true,
      external_id: response.json?.id,
      task_url: response.json?.selfLink
    };

  } else if (action === 'complete') {
    const taskId = config.task_id;
    if (!taskId) {
      throw new Error('task_id required for complete action');
    }

    await httpRequest(
      `https://tasks.googleapis.com/tasks/v1/lists/${tasklist}/tasks/${taskId}`,
      {
        method: 'PATCH',
        hostname: 'tasks.googleapis.com',
        path: `/tasks/v1/lists/${tasklist}/tasks/${taskId}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      },
      JSON.stringify({ status: 'completed' })
    );

    return { success: true, completed: true };
  }

  throw new Error(`Unknown action: ${action}`);
}
