/**
 * Storage Factory
 * Creates the appropriate storage backend based on configuration
 */

import { FilesystemStorage } from './filesystem.js';
import { S3Storage } from './s3.js';
import { R2Storage } from './r2.js';

export { FilesystemStorage, S3Storage, R2Storage };

/**
 * Create storage from environment variables (Node.js only)
 */
export async function createStorageFromEnv() {
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
 * Create storage for Cloudflare Workers (from R2 binding)
 */
export function createR2Storage(r2Bucket) {
  return new R2Storage(r2Bucket);
}
