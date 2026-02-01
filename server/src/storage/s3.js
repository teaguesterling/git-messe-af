/**
 * S3-Compatible Storage Backend
 * Works with AWS S3, MinIO, R2 (via S3 API), etc.
 */

export class S3Storage {
  constructor(config) {
    this.endpoint = config.endpoint;
    this.bucket = config.bucket;
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
    this.region = config.region || 'auto';
    this.type = 's3';
    
    this._client = null;
  }
  
  async getClient() {
    if (this._client) return this._client;
    
    const { S3Client } = await import('@aws-sdk/client-s3');
    
    const config = {
      region: this.region,
      credentials: {
        accessKeyId: this.accessKey,
        secretAccessKey: this.secretKey,
      },
    };
    
    if (this.endpoint) {
      config.endpoint = this.endpoint;
      config.forcePathStyle = true; // Required for MinIO
    }
    
    this._client = new S3Client(config);
    return this._client;
  }
  
  async put(key, data) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    
    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: key.endsWith('.json') ? 'application/json' : 'text/plain',
    }));
  }
  
  async get(key) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      
      return await response.Body.transformToString();
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey') return null;
      throw e;
    }
  }
  
  async list(prefix) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    
    const results = [];
    let continuationToken = null;
    
    do {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      
      for (const obj of response.Contents || []) {
        results.push(obj.Key);
      }
      
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    
    return results;
  }
  
  async delete(key) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    
    await client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }
}
