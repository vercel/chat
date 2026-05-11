/**
 * Shared utilities for email providers.
 *
 * These helpers live here (rather than in every provider) so that adding
 * a new ESP doesn't require reinventing webhook signature verification,
 * HTTP error classification, or RFC-822 header parsing. Each helper is
 * deliberately single-purpose so providers can opt in to whichever
 * behaviors apply to their API.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  ValidationError,
} from "@chat-adapter/shared";

// =============================================================================
// Svix-style HMAC-SHA256 webhook verification
// =============================================================================

/**
 * Verify a Svix-style webhook signature.
 *
 * The signed payload is `${id}.${timestamp}.${body}` and the signature is
 * `v1,<base64(hmac_sha256(secret, payload))>`. The header may contain
 * multiple space-separated signatures (one valid match is sufficient).
 *
 * Used by Resend, and any future provider that adopts the same standard
 * (many ESPs delegate webhook signing to Svix).
 *
 * @see https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
export function verifySvixSignature(args: {
  id: string;
  timestamp: string;
  signatureHeader: string;
  body: string;
  secret: string;
}): boolean {
  const secretBytes = decodeSvixSecret(args.secret);
  if (!secretBytes) {
    return false;
  }
  const signedContent = `${args.id}.${args.timestamp}.${args.body}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest("base64");
  const expectedBuf = Buffer.from(expected, "base64");

  for (const candidate of args.signatureHeader.split(" ")) {
    const [version, value] = candidate.split(",");
    if (version !== "v1" || !value) {
      continue;
    }
    // Buffer.from(string, "base64") never throws on invalid base64 — it
    // produces a (possibly empty) buffer that simply won't match.
    const actualBuf = Buffer.from(value, "base64");
    if (
      actualBuf.length === expectedBuf.length &&
      timingSafeEqual(actualBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Constant-time comparison of two tokens.
 *
 * Use this for any provider whose webhook authentication is just "send
 * back the secret token we configured" (e.g. Inbound's
 * `X-Webhook-Verification-Token`). Falls back to `false` for null/empty
 * inputs and length mismatches so callers don't need to guard.
 *
 * Do **not** use this for HMAC-based schemes — those need
 * {@link verifySvixSignature} or a similar HMAC routine.
 */
export function verifyConstantTimeToken(
  actual: string | null | undefined,
  expected: string
): boolean {
  if (!(actual && expected)) {
    return false;
  }
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Verify Svix headers from a `Request`. Returns `false` if any of the
 * three required headers (`svix-id`, `svix-timestamp`, `svix-signature`)
 * are missing.
 */
export function verifySvixRequest(args: {
  request: Request;
  body: string;
  secret: string;
}): boolean {
  const id = args.request.headers.get("svix-id");
  const timestamp = args.request.headers.get("svix-timestamp");
  const signature = args.request.headers.get("svix-signature");
  if (!(id && timestamp && signature)) {
    return false;
  }
  return verifySvixSignature({
    id,
    timestamp,
    signatureHeader: signature,
    body: args.body,
    secret: args.secret,
  });
}

const SVIX_SECRET_PREFIX = "whsec_";

/**
 * Decode a Svix webhook secret. The format is `whsec_<base64>`. Plain
 * base64 (no prefix) is also tolerated.
 */
function decodeSvixSecret(secret: string): Buffer | null {
  const stripped = secret.startsWith(SVIX_SECRET_PREFIX)
    ? secret.slice(SVIX_SECRET_PREFIX.length)
    : secret;
  if (!stripped) {
    return null;
  }
  // Buffer.from(string, "base64") never throws on invalid input — at worst
  // it returns a buffer that won't match the expected signature.
  return Buffer.from(stripped, "base64");
}

// =============================================================================
// HTTP error classification
// =============================================================================

/**
 * Map an unsuccessful ESP HTTP response to a typed adapter error.
 *
 * Always throws — never returns. The `provider` and `operation` arguments
 * are interpolated into the resulting error message so failures across
 * providers stay diagnosable.
 *
 * Mapping:
 * - `401` / `403` -> {@link AuthenticationError}
 * - `429`         -> {@link AdapterRateLimitError} (with `retry-after`)
 * - `5xx`         -> {@link NetworkError}
 * - everything else -> {@link ValidationError}
 */
export async function throwForEspError(args: {
  response: Response;
  provider: string;
  operation: string;
}): Promise<never> {
  const text = await args.response.text();
  let parsed: { message?: string } | null = null;
  try {
    parsed = JSON.parse(text) as { message?: string };
  } catch {
    // ignore — providers may return non-JSON error bodies
  }
  const message = parsed?.message ?? text;
  const prefix = `${args.provider} ${args.operation}`;

  if (args.response.status === 401 || args.response.status === 403) {
    throw new AuthenticationError("email", `${prefix}: ${message}`);
  }
  if (args.response.status === 429) {
    const retryAfter = Number.parseInt(
      args.response.headers.get("retry-after") ?? "",
      10
    );
    throw new AdapterRateLimitError(
      "email",
      Number.isFinite(retryAfter) ? retryAfter : undefined
    );
  }
  if (args.response.status >= 500) {
    throw new NetworkError(
      "email",
      `${prefix} failed (${args.response.status}): ${message}`
    );
  }
  throw new ValidationError(
    "email",
    `${prefix} failed (${args.response.status}): ${message}`
  );
}

// =============================================================================
// RFC-822 inbound parsing helpers
// =============================================================================

const ADDRESS_WITH_NAME_PATTERN = /^\s*"?([^"<>]*?)"?\s*<([^>]+)>\s*$/;

/**
 * Parse an RFC-822 mailbox value into `{ address, name? }`.
 *
 * Handles both `Name <addr@example.com>` and bare `addr@example.com`.
 * Returns the input verbatim as `address` if no `<...>` envelope is
 * present; downstream code is responsible for validation.
 */
export function parseAddress(value: string): {
  address: string;
  name?: string;
} {
  const match = value.match(ADDRESS_WITH_NAME_PATTERN);
  if (match) {
    const name = match[1]?.trim();
    // The regex `<([^>]+)>` guarantees match[2] when match is truthy.
    const address = (match[2] as string).trim();
    return name ? { address, name } : { address };
  }
  return { address: value.trim() };
}

/**
 * Lowercase all keys of a header object so callers can look up values by
 * canonical name regardless of the source casing.
 *
 * Returns an empty object if `headers` is null/undefined.
 */
export function normalizeHeaderKeys(
  headers: Record<string, string> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
