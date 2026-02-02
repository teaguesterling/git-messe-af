/**
 * MESSE-AF Module
 * Utilities for parsing, serializing, and converting MESSE-AF format
 */

// Parser exports
export {
  parseThread,
  parseThreadV1,
  parseYamlDocs,
  detectFormat,
  getAttachmentType,
  getExtensionFromMime,
  sanitizeFilename
} from './parser.js';

// Serializer exports
export {
  serializeThread,
  serializeThreadV1,
  processMessageAttachments,
  generateFilename,
  MAX_FILE_SIZE,
  MAX_INLINE_SIZE
} from './serializer.js';

// Converter exports
export {
  eventsToMesseAf,
  messeAfToEvents,
  getFolderForStatus,
  generateRef,
  STATUS_FOLDERS
} from './converter.js';
