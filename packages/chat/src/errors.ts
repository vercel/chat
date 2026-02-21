/**
 * Error types for chat-sdk
 */

export class ChatError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.cause = cause;
  }
}

export class RateLimitError extends ChatError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, cause?: unknown) {
    super(message, "RATE_LIMITED", cause);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class LockError extends ChatError {
  constructor(message: string, cause?: unknown) {
    super(message, "LOCK_FAILED", cause);
    this.name = "LockError";
  }
}

export class NotImplementedError extends ChatError {
  readonly feature?: string;

  constructor(message: string, feature?: string, cause?: unknown) {
    super(message, "NOT_IMPLEMENTED", cause);
    this.name = "NotImplementedError";
    this.feature = feature;
  }
}
