/**
 * MESS Exchange Server - Express.js Adapter
 * Entry point for self-hosted deployments (Docker, Kubernetes, bare metal)
 * 
 * Usage:
 *   node src/adapters/express.js
 * 
 * Environment:
 *   PORT=3000
 *   STORAGE_TYPE=filesystem|s3
 *   STORAGE_PATH=./data (for filesystem)
 *   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (for s3)
 */

import express from 'express';
import cors from 'cors';
import { createStorageFromEnv } from '../storage/index.js';
import { createHandlers } from '../core.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize storage and handlers
const storage = await createStorageFromEnv();
const handlers = createHandlers(storage);

console.log(`Storage backend: ${storage.type}`);

// ============ Middleware ============

async function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const apiKey = auth.slice(7);
  const executor = await handlers.authenticate(apiKey);
  
  if (!executor) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  req.auth = executor;
  next();
}

function validateExchange(req, res, next) {
  if (req.auth.exchange_id !== req.params.exchangeId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ============ Routes ============

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mess-exchange', storage: storage.type });
});

// Register (no auth required)
app.post('/api/v1/exchanges/:exchangeId/register', async (req, res) => {
  try {
    const result = await handlers.handleRegister(req.params.exchangeId, req.body);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Protected routes
app.use('/api/v1/exchanges/:exchangeId', authenticate, validateExchange);

// List requests
app.get('/api/v1/exchanges/:exchangeId/requests', async (req, res) => {
  try {
    const result = await handlers.handleListRequests(req.auth, req.query);
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error('List error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Create request
app.post('/api/v1/exchanges/:exchangeId/requests', async (req, res) => {
  try {
    const result = await handlers.handleCreateRequest(req.auth, req.body);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error('Create error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get request
app.get('/api/v1/exchanges/:exchangeId/requests/:ref', async (req, res) => {
  try {
    const result = await handlers.handleGetRequest(req.auth, req.params.ref);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error('Get error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Update request
app.patch('/api/v1/exchanges/:exchangeId/requests/:ref', async (req, res) => {
  try {
    const result = await handlers.handleUpdateRequest(req.auth, req.params.ref, req.body);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error('Update error:', e);
    res.status(500).json({ error: e.message });
  }
});

// List executors
app.get('/api/v1/exchanges/:exchangeId/executors', async (req, res) => {
  try {
    const result = await handlers.handleListExecutors(req.auth);
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error('List executors error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Update executor
app.patch('/api/v1/exchanges/:exchangeId/executors/:executorId', async (req, res) => {
  try {
    const result = await handlers.handleUpdateExecutor(req.auth, req.params.executorId, req.body);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error('Update executor error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MESS Exchange Server listening on port ${PORT}`);
});

export default app;
