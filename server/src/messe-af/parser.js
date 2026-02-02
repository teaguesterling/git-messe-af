/**
 * MESSE-AF Parser
 * Parses v1 (flat file) and v2 (directory-based) MESSE-AF formats
 */

import YAML from 'yaml';

/**
 * Parse thread from v2 directory format
 * @param {Array<{name: string, content: string, sha?: string}>} files - Files in the thread directory
 * @returns {{envelope: Object, messages: Array, attachments: Array}}
 */
export function parseThread(files) {
  // Sort yaml files by numeric prefix
  const yamlFiles = files
    .filter(f => f.name.endsWith('.messe-af.yaml'))
    .sort((a, b) => {
      const numA = parseInt(a.name.split('-')[0]);
      const numB = parseInt(b.name.split('-')[0]);
      return numA - numB;
    });

  if (yamlFiles.length === 0) {
    throw new Error('No YAML files found in thread directory');
  }

  // Parse first file for envelope
  const firstContent = yamlFiles[0].content;
  const firstDocs = parseYamlDocs(firstContent);
  const envelope = firstDocs[0];
  const messages = firstDocs.slice(1);

  // Parse remaining files for additional messages
  for (let i = 1; i < yamlFiles.length; i++) {
    const content = yamlFiles[i].content;
    const docs = parseYamlDocs(content);
    messages.push(...docs);
  }

  // Collect attachment info
  const attachments = files
    .filter(f => f.name.startsWith('att-'))
    .map(f => ({ name: f.name, sha: f.sha, content: f.content }));

  return { envelope, messages, attachments };
}

/**
 * Parse thread from v1 flat file format
 * @param {string} content - YAML content with multiple documents
 * @returns {{envelope: Object, messages: Array, attachments: Array}}
 */
export function parseThreadV1(content) {
  const docs = parseYamlDocs(content);
  return { envelope: docs[0], messages: docs.slice(1), attachments: [] };
}

/**
 * Parse multi-document YAML string
 * @param {string} content - YAML content with --- separators
 * @returns {Array<Object>}
 */
export function parseYamlDocs(content) {
  return content
    .split(/^---$/m)
    .filter(d => d.trim())
    .map(d => YAML.parse(d));
}

/**
 * Detect format version from files or content
 * @param {Array|string} input - Files array (v2) or content string (v1)
 * @returns {'v1'|'v2'}
 */
export function detectFormat(input) {
  if (Array.isArray(input)) {
    return 'v2';
  }
  return 'v1';
}

/**
 * Get attachment type from MIME type
 * @param {string} mimeType
 * @returns {'image'|'audio'|'video'|'file'}
 */
export function getAttachmentType(mimeType) {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * Get file extension from MIME type
 * @param {string} mimeType
 * @returns {string}
 */
export function getExtensionFromMime(mimeType) {
  const mimeToExt = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'application/pdf': 'pdf', 'text/plain': 'txt'
  };
  return mimeToExt[mimeType] || 'bin';
}

/**
 * Sanitize filename for safe storage
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
}
