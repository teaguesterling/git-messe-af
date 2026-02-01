/**
 * MESS Exchange Server - Cloudflare Worker Adapter
 * Entry point for Cloudflare Workers + R2 deployments
 * 
 * Deploy with:
 *   npx wrangler deploy --config deploy/cloudflare/wrangler.toml
 */

import { R2Storage } from '../storage/r2.js';
import { createHandlers } from '../core.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    
    // Initialize storage with R2 binding
    const storage = new R2Storage(env.MESS_BUCKET);
    const handlers = createHandlers(storage);
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Health check
    if (path === '/health') {
      return json({ status: 'ok', service: 'mess-exchange', storage: 'r2' });
    }
    
    // Parse API route
    const apiMatch = path.match(/^\/api\/v1\/exchanges\/([^\/]+)(.*)$/);
    if (!apiMatch) {
      return error('Not found', 404);
    }
    
    const exchangeId = apiMatch[1];
    const subpath = apiMatch[2] || '';
    
    try {
      // Registration (no auth)
      if (subpath === '/register' && request.method === 'POST') {
        const body = await request.json();
        const result = await handlers.handleRegister(exchangeId, body);
        if (result.error) {
          return error(result.error, result.status);
        }
        return json(result.data, result.status);
      }
      
      // Authenticate
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return error('Unauthorized', 401);
      }
      
      const apiKey = authHeader.slice(7);
      const auth = await handlers.authenticate(apiKey);
      
      if (!auth) {
        return error('Invalid API key', 401);
      }
      
      if (auth.exchange_id !== exchangeId) {
        return error('Forbidden', 403);
      }
      
      // Route handlers
      
      // List requests
      if (subpath === '/requests' && request.method === 'GET') {
        const status = url.searchParams.get('status');
        const result = await handlers.handleListRequests(auth, { status });
        return json(result.data, result.status);
      }
      
      // Create request
      if (subpath === '/requests' && request.method === 'POST') {
        const body = await request.json();
        const result = await handlers.handleCreateRequest(auth, body);
        if (result.error) {
          return error(result.error, result.status);
        }
        return json(result.data, result.status);
      }
      
      // Get request
      const reqMatch = subpath.match(/^\/requests\/([^\/]+)$/);
      if (reqMatch && request.method === 'GET') {
        const result = await handlers.handleGetRequest(auth, reqMatch[1]);
        if (result.error) {
          return error(result.error, result.status);
        }
        return json(result.data, result.status);
      }
      
      // Update request
      if (reqMatch && request.method === 'PATCH') {
        const body = await request.json();
        const result = await handlers.handleUpdateRequest(auth, reqMatch[1], body);
        if (result.error) {
          return error(result.error, result.status);
        }
        return json(result.data, result.status);
      }
      
      // List executors
      if (subpath === '/executors' && request.method === 'GET') {
        const result = await handlers.handleListExecutors(auth);
        return json(result.data, result.status);
      }
      
      // Update executor
      const execMatch = subpath.match(/^\/executors\/([^\/]+)$/);
      if (execMatch && request.method === 'PATCH') {
        const body = await request.json();
        const result = await handlers.handleUpdateExecutor(auth, execMatch[1], body);
        if (result.error) {
          return error(result.error, result.status);
        }
        return json(result.data, result.status);
      }
      
      return error('Not found', 404);
      
    } catch (e) {
      console.error('Error:', e);
      return error(e.message || 'Internal server error', 500);
    }
  },
};
