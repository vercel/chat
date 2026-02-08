/**
 * X webhook security utilities.
 *
 * Handles two security mechanisms:
 * 1. CRC Challenge: X periodically sends GET requests with a `crc_token`
 *    to verify ownership of the webhook URL.
 * 2. Signature Verification: Each POST request includes an
 *    `x-twitter-webhooks-signature` header that must be verified.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Handle a CRC (Challenge Response Check) from X.
 *
 * X sends a GET request with a `crc_token` query parameter.
 * We must respond with an HMAC-SHA256 hash of the token using
 * the app's consumer secret, base64-encoded.
 *
 * @param crcToken - The challenge token from the `crc_token` query param
 * @param consumerSecret - The app's consumer secret (API Secret)
 * @returns A Response with the JSON `{ response_token: "sha256=..." }`
 */
export function handleCrcChallenge(
  crcToken: string,
  consumerSecret: string,
): Response {
  console.log("[X CRC] handleCrcChallenge called", {
    crcToken,
    consumerSecretLength: consumerSecret.length,
  });

  const hmac = createHmac("sha256", consumerSecret)
    .update(crcToken)
    .digest("base64");

  const responseBody = JSON.stringify({ response_token: `sha256=${hmac}` });

  console.log("[X CRC] HMAC computed", {
    hmacLength: hmac.length,
    responseBody,
  });

  return new Response(responseBody, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Verify the signature of an incoming webhook POST request from X.
 *
 * X signs each POST body with the app's consumer secret using
 * HMAC-SHA256 (base64-encoded) and sends it in the
 * `x-twitter-webhooks-signature` header as `sha256=<hash>`.
 *
 * @param body - The raw request body string
 * @param signature - The value of the `x-twitter-webhooks-signature` header
 * @param consumerSecret - The app's consumer secret (API Secret)
 * @returns `true` if the signature is valid
 */
export function verifyWebhookSignature(
  body: string,
  signature: string | null,
  consumerSecret: string,
): boolean {
  if (!signature) {
    return false;
  }

  const expected =
    "sha256=" +
    createHmac("sha256", consumerSecret).update(body).digest("base64");

  // Guard against length mismatches which would throw in timingSafeEqual
  if (signature.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
