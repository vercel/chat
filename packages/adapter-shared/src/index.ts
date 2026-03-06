/**
 * @chat-adapter/shared
 *
 * Shared utilities for chat SDK adapters.
 * Reduces code duplication across adapter implementations.
 */

// Adapter utilities
export { extractCard, extractFiles } from "./adapter-utils";

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
