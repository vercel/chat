/**
 * @chat-adapter/shared
 *
 * Shared utilities for chat SDK adapters.
 * Reduces code duplication across adapter implementations.
 */

// Adapter utilities
export {
  extractCard,
  extractFiles,
  extractPostableAttachments,
} from "./adapter-utils";

// Buffer conversion utilities
export {
  bufferToDataUri,
  type FileDataInput,
  type ToBufferOptions,
  toBuffer,
  toBufferSync,
} from "./buffer-utils";

// Card conversion utilities
export {
  BUTTON_STYLE_MAPPINGS,
  cardToFallbackText,
  createEmojiConverter,
  escapeTableCell,
  type FallbackTextOptions,
  mapButtonStyle,
  type PlatformName,
  renderGfmTable,
} from "./card-utils";

// Slack-style ``` fence normalization for CommonMark parsing
export {
  type NormalizeCodeFencesOptions,
  normalizeCodeFences,
} from "./code-fences";

// Token encryption helpers (AES-256-GCM)
export {
  decodeKey,
  decryptToken,
  type EncryptedTokenData,
  encryptToken,
  isEncryptedTokenData,
} from "./crypto";

// Guarded downloads for untrusted attachment URLs (SSRF-safe, size- and time-limited)
export {
  type AttachmentTransport,
  type DownloadAttachmentOptions,
  downloadAttachment,
} from "./download";

// Standardized adapter errors
export {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "./errors";

// Bare @mention resolution (skips code, URLs, hosts, and existing tokens)
export { type MentionReplacer, replaceBareMentions } from "./mentions";
