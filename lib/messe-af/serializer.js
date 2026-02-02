/**
 * MESSE-AF Serializer
 * Serializes threads to v1 (flat file) and v2 (directory-based) MESSE-AF formats
 */

import YAML from 'yaml';
import { getAttachmentType, getExtensionFromMime } from './parser.js';

// Size limits (in bytes)
export const MAX_FILE_SIZE = 1024 * 1024;        // 1 MB - GitHub Contents API limit
export const MAX_INLINE_SIZE = 768 * 1024;       // 768 KB - inline attachment limit

/**
 * Serialize thread to v2 directory format
 * @param {Object} envelope - Thread envelope (ref, status, etc.)
 * @param {Array} messages - Thread messages
 * @param {Array} existingAttachments - Existing external attachments
 * @returns {Array<{name: string, content: string, binary?: boolean}>}
 */
export function serializeThread(envelope, messages, existingAttachments = []) {
  const files = [];
  const attachments = [...existingAttachments];

  // Calculate next attachment serial from existing attachments
  let nextAttachmentSerial = 1;
  for (const att of attachments) {
    const match = att.name.match(/^att-(\d+)-/);
    if (match) {
      const serial = parseInt(match[1]);
      if (serial >= nextAttachmentSerial) nextAttachmentSerial = serial + 1;
    }
  }

  // Start with envelope in file 000
  let currentFileNum = 0;
  let currentDocs = [envelope];
  let currentSize = Buffer.byteLength(YAML.stringify(envelope, { lineWidth: -1 }));

  // Process each message, potentially creating overflow files
  for (const msg of messages) {
    // Check for large inline attachments that need externalizing
    const processedMsg = processMessageAttachments(msg, attachments, nextAttachmentSerial);
    if (processedMsg.newAttachments) {
      for (const att of processedMsg.newAttachments) {
        attachments.push(att);
        nextAttachmentSerial++;
      }
    }

    const msgYaml = YAML.stringify(processedMsg.message, { lineWidth: -1 });
    const msgSize = Buffer.byteLength(msgYaml);

    // Would adding this message exceed the limit?
    if (currentSize + msgSize + 4 > MAX_FILE_SIZE && currentDocs.length > 1) {
      // Save current file and start new one
      files.push({
        name: `${currentFileNum.toString().padStart(3, '0')}-${envelope.ref}.messe-af.yaml`,
        content: currentDocs.map(d => YAML.stringify(d, { lineWidth: -1 })).join('---\n')
      });
      currentFileNum++;
      currentDocs = [];
      currentSize = 0;
    }

    currentDocs.push(processedMsg.message);
    currentSize += msgSize + 4; // +4 for "---\n"
  }

  // Save final file
  if (currentDocs.length > 0) {
    files.push({
      name: `${currentFileNum.toString().padStart(3, '0')}-${envelope.ref}.messe-af.yaml`,
      content: currentDocs.map(d => YAML.stringify(d, { lineWidth: -1 })).join('---\n')
    });
  }

  // Add attachment files
  for (const att of attachments) {
    files.push({ name: att.name, content: att.content, binary: att.binary });
  }

  return files;
}

/**
 * Serialize thread to v1 flat file format
 * @param {Object} envelope - Thread envelope
 * @param {Array} messages - Thread messages
 * @returns {string}
 */
export function serializeThreadV1(envelope, messages) {
  const docs = [envelope, ...messages];
  return docs.map(d => YAML.stringify(d, { lineWidth: -1 })).join('---\n');
}

/**
 * Process message to externalize large attachments
 * @param {Object} msg - Message object
 * @param {Array} existingAttachments - Already externalized attachments
 * @param {number} startSerial - Starting serial number for new attachments
 * @returns {{message: Object, newAttachments: Array}}
 */
export function processMessageAttachments(msg, existingAttachments, startSerial) {
  const newAttachments = [];
  let serial = startSerial;

  // Deep clone the message to avoid modifying original
  const processedMsg = JSON.parse(JSON.stringify(msg));

  // Look for large inline attachments in MESS items
  if (processedMsg.MESS) {
    for (const item of processedMsg.MESS) {
      if (item.response?.content) {
        item.response.content = item.response.content.map(c => {
          if (typeof c === 'object' && c.image) {
            const dataUrl = c.image;
            const size = Buffer.byteLength(dataUrl);

            if (size > MAX_INLINE_SIZE) {
              // Extract mime and data
              const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                const [, mime, base64Data] = match;
                const type = getAttachmentType(mime);
                const ext = getExtensionFromMime(mime);
                const attName = `att-${serial.toString().padStart(3, '0')}-${type}-image.${ext}`;

                newAttachments.push({
                  name: attName,
                  content: base64Data,
                  binary: true
                });
                serial++;

                // Replace with file reference
                return {
                  file: {
                    path: attName,
                    name: `image.${ext}`,
                    mime: mime
                  }
                };
              }
            }
          }
          return c;
        });
      }
    }
  }

  return { message: processedMsg, newAttachments };
}

/**
 * Generate YAML filename for a thread file
 * @param {number} fileNum - File number (0-indexed)
 * @param {string} ref - Thread reference
 * @returns {string}
 */
export function generateFilename(fileNum, ref) {
  return `${fileNum.toString().padStart(3, '0')}-${ref}.messe-af.yaml`;
}
