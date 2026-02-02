/**
 * Blob Storage Abstraction
 *
 * Provides a simple interface for storing binary blobs (attachments)
 * separately from the main thread storage.
 *
 * This is useful when:
 * - Attachments are large and should be stored in a CDN or object store
 * - You want to keep MESSE-AF files under the 1MB limit
 * - You need different retention policies for attachments
 */

/**
 * Blob Store using a base storage backend
 */
export class BlobStore {
  /**
   * @param {Object} storage - Base storage backend
   * @param {Object} options
   * @param {string} options.prefix - Prefix for all blob keys
   */
  constructor(storage, options = {}) {
    this.storage = storage;
    this.prefix = options.prefix || 'blobs/';
    this.type = 'blob-store';
  }

  /**
   * Store a blob
   * @param {string} key - Blob key (relative to prefix)
   * @param {Buffer|string} data - Blob data
   * @param {Object} options
   * @param {string} options.contentType - MIME type
   * @returns {Promise<{key: string, size: number}>}
   */
  async put(key, data, options = {}) {
    const fullKey = this.prefix + key;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    await this.storage.put(fullKey, buffer);

    return {
      key: fullKey,
      size: buffer.length
    };
  }

  /**
   * Get a blob
   * @param {string} key - Blob key (relative to prefix)
   * @returns {Promise<Buffer|null>}
   */
  async get(key) {
    const fullKey = this.prefix + key;
    return this.storage.get(fullKey);
  }

  /**
   * Delete a blob
   * @param {string} key - Blob key (relative to prefix)
   */
  async delete(key) {
    const fullKey = this.prefix + key;
    return this.storage.delete(fullKey);
  }

  /**
   * List blobs with a prefix
   * @param {string} prefix - Prefix to filter by
   * @returns {Promise<string[]>}
   */
  async list(prefix = '') {
    const fullPrefix = this.prefix + prefix;
    const keys = await this.storage.list(fullPrefix);
    // Remove the blob store prefix from returned keys
    return keys.map(k => k.slice(this.prefix.length));
  }

  /**
   * Check if a blob exists
   * @param {string} key - Blob key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    const data = await this.get(key);
    return data !== null;
  }

  /**
   * Get blob metadata (if supported by backend)
   * @param {string} key - Blob key
   * @returns {Promise<Object|null>}
   */
  async getMetadata(key) {
    const fullKey = this.prefix + key;

    // If storage has metadata support, use it
    if (typeof this.storage.getMetadata === 'function') {
      return this.storage.getMetadata(fullKey);
    }

    // Otherwise, check if blob exists
    const exists = await this.exists(key);
    return exists ? { key: fullKey } : null;
  }

  /**
   * Copy a blob
   * @param {string} sourceKey - Source blob key
   * @param {string} destKey - Destination blob key
   */
  async copy(sourceKey, destKey) {
    const data = await this.get(sourceKey);
    if (data === null) {
      throw new Error(`Blob not found: ${sourceKey}`);
    }
    await this.put(destKey, data);
  }
}

/**
 * Create a blob store from environment variables
 * Falls back to main storage if no separate blob storage is configured
 */
export async function createBlobStoreFromEnv(mainStorage) {
  const type = process.env.BLOB_STORAGE_TYPE;

  if (!type) {
    // Use main storage with blobs/ prefix
    return new BlobStore(mainStorage, {
      prefix: 'blobs/'
    });
  }

  switch (type) {
    case 's3': {
      const { S3Storage } = await import('./s3.js');
      const storage = new S3Storage({
        endpoint: process.env.BLOB_S3_ENDPOINT || process.env.S3_ENDPOINT,
        bucket: process.env.BLOB_STORAGE_BUCKET || process.env.S3_BUCKET,
        accessKey: process.env.BLOB_S3_ACCESS_KEY || process.env.S3_ACCESS_KEY,
        secretKey: process.env.BLOB_S3_SECRET_KEY || process.env.S3_SECRET_KEY,
        region: process.env.BLOB_S3_REGION || process.env.S3_REGION || 'auto',
      });
      return new BlobStore(storage, { prefix: '' });
    }

    case 'filesystem': {
      const { FilesystemStorage } = await import('./filesystem.js');
      const storage = new FilesystemStorage(
        process.env.BLOB_STORAGE_PATH || './data/blobs'
      );
      return new BlobStore(storage, { prefix: '' });
    }

    default:
      console.warn(`Unknown blob storage type: ${type}, using main storage`);
      return new BlobStore(mainStorage, { prefix: 'blobs/' });
  }
}
