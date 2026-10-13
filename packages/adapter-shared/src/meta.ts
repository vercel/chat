/**
 * Helpers shared by the Meta platform adapters (Messenger, Instagram, and
 * WhatsApp). All three receive webhooks through the same Meta webhook
 * infrastructure and call variants of the Graph API.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  ResourceNotFoundError,
  ValidationError,
} from "./errors";

const META_SIGNATURE_PATTERN = /^sha256=([0-9a-fA-F]+)$/;

/**
 * Check a Meta webhook subscription request (`GET` with `hub.mode`,
 * `hub.verify_token`, and `hub.challenge` query parameters).
 *
 * @returns The challenge to echo back (an empty string when Meta omitted it),
 * or `null` when the mode or verify token does not match.
 */
export function verifyMetaWebhookChallenge(
  request: Request,
  verifyToken: string
): string | null {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  if (mode !== "subscribe" || token !== verifyToken) {
    return null;
  }
  return url.searchParams.get("hub.challenge") ?? "";
}

/**
 * Verify the `X-Hub-Signature-256` header Meta sends with webhook payloads:
 * `sha256=` followed by the hex HMAC-SHA256 of the raw body keyed with the app
 * secret. Compares in constant time.
 */
export function verifyMetaSignature(
  body: string,
  signature: string | null | undefined,
  appSecret: string
): boolean {
  const hash = signature?.match(META_SIGNATURE_PATTERN)?.[1];
  if (!hash) {
    return false;
  }
  const expected = createHmac("sha256", appSecret)
    .update(body, "utf8")
    .digest();
  const received = Buffer.from(hash, "hex");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/**
 * Parse a `Retry-After` header given in seconds.
 *
 * @returns The positive number of seconds, or `undefined` when the header is
 * missing or not a positive integer.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** The `error` object in a Graph API error response body. */
export interface MetaGraphError {
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  message?: string;
  type?: string;
}

/** Arguments for {@link throwMetaGraphApiError}. */
export interface MetaGraphApiErrorOptions {
  /** Adapter name used in the thrown error, such as `"messenger"`. */
  adapter: string;
  /** Parsed response body. */
  data: Record<string, unknown>;
  /** Graph API endpoint that failed, used in error messages. */
  endpoint: string;
  /** Human-readable platform name, such as `"Messenger"`. */
  label: string;
  /** Parsed `Retry-After` header, forwarded on rate-limit errors. */
  retryAfter?: number;
  /** HTTP response status. */
  status: number;
}

/**
 * Map a failed Graph API response onto the shared adapter errors.
 *
 * - HTTP 429 or Meta codes 4, 32, 613: {@link AdapterRateLimitError}
 * - HTTP 401 or Meta code 190: {@link AuthenticationError}
 * - HTTP 403 or Meta codes 10, 200: {@link ValidationError}
 * - HTTP 404: {@link ResourceNotFoundError}
 * - Anything else: {@link NetworkError}
 */
export function throwMetaGraphApiError(
  options: MetaGraphApiErrorOptions
): never {
  const { adapter, data, endpoint, label, retryAfter, status } = options;
  const error = data.error as MetaGraphError | undefined;
  const message = error?.message ?? `${label} API ${endpoint} failed`;
  const code = error?.code ?? status;

  if (status === 429 || code === 4 || code === 32 || code === 613) {
    throw new AdapterRateLimitError(adapter, retryAfter);
  }
  if (status === 401 || code === 190) {
    throw new AuthenticationError(adapter, message);
  }
  if (status === 403 || code === 10 || code === 200) {
    throw new ValidationError(adapter, message);
  }
  if (status === 404) {
    throw new ResourceNotFoundError(adapter, endpoint);
  }
  throw new NetworkError(
    adapter,
    `${message} (status ${status}, code ${code})`
  );
}
