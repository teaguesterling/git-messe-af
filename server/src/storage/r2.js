/**
 * Cloudflare R2 Storage Backend
 * For Cloudflare Workers deployments
 * Uses the R2 binding directly (not S3 API)
 */

export class R2Storage {
  constructor(bucket) {
    // bucket is the R2 binding from env (e.g., env.MESS_BUCKET)
    this.bucket = bucket;
    this.type = 'r2';
  }
  
  async put(key, data) {
    await this.bucket.put(key, data);
  }
  
  async get(key) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return await obj.text();
  }
  
  async list(prefix) {
    const results = [];
    let cursor = null;
    
    do {
      const listed = await this.bucket.list({
        prefix,
        cursor,
      });
      
      for (const obj of listed.objects) {
        results.push(obj.key);
      }
      
      cursor = listed.truncated ? listed.cursor : null;
    } while (cursor);
    
    return results;
  }
  
  async delete(key) {
    await this.bucket.delete(key);
  }
}
