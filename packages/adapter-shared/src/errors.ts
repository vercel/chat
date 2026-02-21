/**
 * Standardized error types for chat adapters.
 *
 * These error classes provide consistent error handling across all
 * adapter implementations.
 */

/**
 * Base error class for adapter operations.
 *
 * All adapter-specific errors should extend this class.
 */
export class AdapterError extends Error {
  /**
   * @param message - Human-readable error message
   * @param adapter - Name of the adapter (e.g., "slack", "teams", "gchat")
   * @param code - Optional error code for programmatic handling
   */
  constructor(
    message: string,
    public readonly adapter: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/**
 * Rate limit error - thrown when platform API rate limits are hit.
 *
 * @example
 * ```typescript
 * throw new AdapterRateLimitError("slack", 30);
 * // message: "Rate limited by slack, retry after 30s"
 * ```
 */
export class AdapterRateLimitError extends AdapterError {
  constructor(
    adapter: string,
    public readonly retryAfter?: number
  ) {
    super(
      `Rate limited by ${adapter}${retryAfter ? `, retry after ${retryAfter}s` : ""}`,
      adapter,
      "RATE_LIMITED"
    );
    this.name = "AdapterRateLimitError";
  }
}

/**
 * Authentication error - thrown when credentials are invalid or expired.
 *
 * @example
 * ```typescript
 * throw new AuthenticationError("teams", "Token expired");
 * ```
 */
export class AuthenticationError extends AdapterError {
  constructor(adapter: string, message?: string) {
    super(
      message || `Authentication failed for ${adapter}`,
      adapter,
      "AUTH_FAILED"
    );
    this.name = "AuthenticationError";
  }
}

/**
 * Not found error - thrown when a requested resource doesn't exist.
 *
 * @example
 * ```typescript
 * throw new ResourceNotFoundError("slack", "channel", "C123456");
 * // message: "channel 'C123456' not found in slack"
 * ```
 */
export class ResourceNotFoundError extends AdapterError {
  constructor(
    adapter: string,
    public readonly resourceType: string,
    public readonly resourceId?: string
  ) {
    const idPart = resourceId ? ` '${resourceId}'` : "";
    super(
      `${resourceType}${idPart} not found in ${adapter}`,
      adapter,
      "NOT_FOUND"
    );
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Permission error - thrown when the bot lacks required permissions.
 *
 * @example
 * ```typescript
 * throw new PermissionError("teams", "send messages", "channels:write");
 * ```
 */
export class PermissionError extends AdapterError {
  constructor(
    adapter: string,
    public readonly action: string,
    public readonly requiredScope?: string
  ) {
    const scopePart = requiredScope ? ` (requires: ${requiredScope})` : "";
    super(
      `Permission denied: cannot ${action} in ${adapter}${scopePart}`,
      adapter,
      "PERMISSION_DENIED"
    );
    this.name = "PermissionError";
  }
}

/**
 * Validation error - thrown when input data is invalid.
 *
 * @example
 * ```typescript
 * throw new ValidationError("slack", "Message text exceeds 40000 characters");
 * ```
 */
export class ValidationError extends AdapterError {
  constructor(adapter: string, message: string) {
    super(message, adapter, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

/**
 * Network error - thrown when there's a network/connectivity issue.
 *
 * @example
 * ```typescript
 * throw new NetworkError("gchat", "Connection timeout after 30s");
 * ```
 */
export class NetworkError extends AdapterError {
  constructor(
    adapter: string,
    message?: string,
    public readonly originalError?: Error
  ) {
    super(
      message || `Network error communicating with ${adapter}`,
      adapter,
      "NETWORK_ERROR"
    );
    this.name = "NetworkError";
  }
}
