/**
 * Error types for chat-sdk
 */

export class ChatError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export class RateLimitError extends ChatError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    cause?: unknown
  ) {
    super(message, "RATE_LIMITED", cause);
    this.name = "RateLimitError";
  }
}

export class LockError extends ChatError {
  constructor(message: string, cause?: unknown) {
    super(message, "LOCK_FAILED", cause);
    this.name = "LockError";
  }
}

export class NotImplementedError extends ChatError {
  constructor(
    message: string,
    public readonly feature?: string,
    cause?: unknown
  ) {
    super(message, "NOT_IMPLEMENTED", cause);
    this.name = "NotImplementedError";
  }
}
