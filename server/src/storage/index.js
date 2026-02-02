/**
 * Storage Factory
 * Creates the appropriate storage backend based on configuration
 *
 * Storage Modes:
 * - event-sourced: Original event-based storage (default)
 * - messe-af: MESSE-AF file-based storage with Hive partitioning
 *
 * Environment Variables:
 * - STORAGE_TYPE: filesystem | s3 (base storage backend)
 * - STORAGE_MODE: event-sourced | messe-af (storage format)
 * - MESSE_AF_VERSION: 1 | 2 (MESSE-AF version, default 2)
 * - BLOB_STORAGE_TYPE: s3 | filesystem (optional separate blob storage)
 */

import { FilesystemStorage } from './filesystem.js';
import { S3Storage } from './s3.js';
import { R2Storage } from './r2.js';
import { MesseAfStorage } from './messe-af-storage.js';
import { BlobStore, createBlobStoreFromEnv } from './blob-store.js';

export { FilesystemStorage, S3Storage, R2Storage, MesseAfStorage, BlobStore };

/**
 * Create base storage backend from environment
 * @returns {Promise<Object>}
 */
async function createBaseStorage() {
  const type = process.env.STORAGE_TYPE || 'filesystem';

  switch (type) {
    case 'filesystem':
      return new FilesystemStorage(process.env.STORAGE_PATH || './data');

    case 's3':
      return new S3Storage({
        endpoint: process.env.S3_ENDPOINT,
        bucket: process.env.S3_BUCKET,
        accessKey: process.env.S3_ACCESS_KEY,
        secretKey: process.env.S3_SECRET_KEY,
        region: process.env.S3_REGION || 'auto',
      });

    default:
      throw new Error(`Unknown storage type: ${type}. Set STORAGE_TYPE to 'filesystem' or 's3'.`);
  }
}

/**
 * Create storage from environment variables (Node.js only)
 * @returns {Promise<Object>}
 */
export async function createStorageFromEnv() {
  const mode = process.env.STORAGE_MODE || 'event-sourced';
  const baseStorage = await createBaseStorage();

  if (mode === 'messe-af') {
    const version = parseInt(process.env.MESSE_AF_VERSION || '2');
    const blobStore = await createBlobStoreFromEnv(baseStorage);

    return new MesseAfStorage(baseStorage, {
      version,
      blobStore
    });
  }

  // Default: event-sourced mode (original behavior)
  return baseStorage;
}

/**
 * Create storage for Cloudflare Workers (from R2 binding)
 * @param {Object} r2Bucket - R2 bucket binding
 * @param {Object} options
 * @param {string} options.mode - Storage mode (event-sourced or messe-af)
 * @param {number} options.version - MESSE-AF version if using messe-af mode
 * @returns {Object}
 */
export function createR2Storage(r2Bucket, options = {}) {
  const base = new R2Storage(r2Bucket);

  if (options.mode === 'messe-af') {
    return new MesseAfStorage(base, {
      version: options.version || 2,
      blobStore: options.blobBucket ? new R2Storage(options.blobBucket) : base
    });
  }

  return base;
}

/**
 * Get storage mode description
 * @param {Object} storage - Storage instance
 * @returns {string}
 */
export function getStorageDescription(storage) {
  if (storage instanceof MesseAfStorage) {
    return `messe-af-v${storage.version} (${storage.storage.type})`;
  }
  return storage.type || 'unknown';
}
