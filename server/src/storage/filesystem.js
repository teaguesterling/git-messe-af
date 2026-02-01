/**
 * Filesystem Storage Backend
 * For self-hosted deployments
 */

import fs from 'fs/promises';
import path from 'path';

export class FilesystemStorage {
  constructor(basePath = './data') {
    this.basePath = basePath;
    this.type = 'filesystem';
  }
  
  async put(key, data) {
    const filePath = path.join(this.basePath, key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, data, 'utf8');
  }
  
  async get(key) {
    const filePath = path.join(this.basePath, key);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  
  async list(prefix) {
    const dirPath = path.join(this.basePath, prefix);
    const results = [];
    
    const walk = async (dir, base) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(base, entry.name);
          
          if (entry.isDirectory()) {
            await walk(fullPath, relativePath);
          } else if (entry.isFile()) {
            results.push(path.join(prefix, relativePath));
          }
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    };
    
    await walk(dirPath, '');
    return results;
  }
  
  async delete(key) {
    const filePath = path.join(this.basePath, key);
    try {
      await fs.unlink(filePath);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}
