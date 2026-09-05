import { AdapterError } from "@chat-adapter/shared";
import type { WhatsAppGraphError, WhatsAppGraphErrorBody } from "./types";

/** Longest slice of a non-JSON response body kept in the error message. */
const MESSAGE_BODY_LIMIT = 500;
const INTEGER_STRING = /^-?\d+$/;

/**
 * Meta error codes that the Graph API uses for throttling.
 *
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes/
 */
const RATE_LIMIT_CODES = new Set([
  4, 17, 32, 613, 80_007, 130_429, 131_048, 131_056,
]);
const AUTH_CODES = new Set([0, 190]);
const PERMISSION_CODES = new Set([3, 10]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read an integer field, accepting the numeric strings that proxies and
 * emulators in front of the Cloud API sometimes emit.
 */
function integer(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : undefined;
  }
  if (typeof value === "string" && INTEGER_STRING.test(value)) {
    return Number(value);
  }
  return undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseGraphError(raw: unknown): WhatsAppGraphError | undefined {
  const error = record(record(raw)?.error);
  if (!error) {
    return undefined;
  }
  const details = string(record(error.error_data)?.details);
  return {
    code: integer(error.code),
    error_data: details === undefined ? undefined : { details },
    error_subcode: integer(error.error_subcode),
    fbtrace_id: string(error.fbtrace_id),
    message: string(error.message),
    type: string(error.type),
  };
}

/**
 * Map an HTTP status and Meta error code onto the shared `AdapterError.code`
 * taxonomy so cross-adapter handlers can branch without WhatsApp knowledge.
 */
function taxonomyCode(status: number, code?: number): string | undefined {
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    return "RATE_LIMITED";
  }
  if (status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
    return "AUTH_FAILED";
  }
  if (
    status === 403 ||
    (code !== undefined &&
      (PERMISSION_CODES.has(code) || (code >= 200 && code <= 299)))
  ) {
    return "PERMISSION_DENIED";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  return undefined;
}

/**
 * A non-2xx response from the Meta Graph API.
 *
 * `code` follows the shared `AdapterError` taxonomy (`RATE_LIMITED`,
 * `AUTH_FAILED`, `PERMISSION_DENIED`, `NOT_FOUND`) when the status or Meta
 * error code maps onto it. Meta's own numeric code is exposed as `errorCode`.
 */
export class WhatsAppApiError extends AdapterError {
  /** HTTP response status. */
  readonly status: number;
  /** Meta's numeric error code, such as `130429`. */
  readonly errorCode?: number;
  /** Meta's human-readable `error.message`. */
  readonly providerMessage?: string;
  /** Meta's `error.type`, such as `"OAuthException"`. */
  readonly type?: string;
  /** Meta's `error.error_data.details`. */
  readonly details?: string;
  /** Meta's `error.error_subcode`. Optional and deprecated in the Cloud API. */
  readonly subcode?: number;
  /** Meta's `error.fbtrace_id`. */
  readonly traceId?: string;
  /**
   * The parsed response body, shaped like {@link WhatsAppGraphErrorBody} when
   * Meta answered with its error envelope, or the original text when the body
   * is not valid JSON.
   */
  readonly raw: unknown;

  constructor(message: string, status: number, body: string) {
    let raw: unknown = body;
    try {
      raw = JSON.parse(body);
    } catch {
      // Keep the text body for non-JSON responses such as proxy error pages.
    }

    const error = parseGraphError(raw);
    const summary =
      error?.message ??
      (body.length > MESSAGE_BODY_LIMIT
        ? `${body.slice(0, MESSAGE_BODY_LIMIT)}…`
        : body);
    super(
      `${message}: ${status} ${summary}`,
      "whatsapp",
      taxonomyCode(status, error?.code)
    );
    this.name = "WhatsAppApiError";
    this.status = status;
    this.raw = raw;
    this.errorCode = error?.code;
    this.providerMessage = error?.message;
    this.type = error?.type;
    this.details = error?.error_data?.details;
    this.subcode = error?.error_subcode;
    this.traceId = error?.fbtrace_id;
  }
}
