/**
 * X webhook security utilities.
 *
 * Handles three mechanisms:
 * 1. CRC Challenge: X periodically sends GET requests with a `crc_token`
 *    to verify ownership of the webhook URL.
 * 2. Signature Verification: Each POST request includes an
 *    `x-twitter-webhooks-signature` header that must be verified.
 * 3. User Subscription: Subscribe the authenticated user to a webhook
 *    so Account Activity events start flowing.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import OAuth from "oauth-1.0a";

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

// ---------------------------------------------------------------------------
// User subscription
// ---------------------------------------------------------------------------

/** OAuth1 credentials required for user subscription. */
export interface OAuth1Credentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/** Result of a subscription attempt. */
export interface SubscribeResult {
  /** Whether the subscription is active (true for both new and duplicate). */
  subscribed: boolean;
  /** Whether this was a new subscription or already existed. */
  alreadySubscribed: boolean;
}

/**
 * Subscribe the authenticated user to a webhook for Account Activity events.
 *
 * Calls `POST /2/account_activity/webhooks/:webhook_id/subscriptions/all`
 * with OAuth 1.0a user-context authentication.
 *
 * @param webhookId - The webhook ID from the X developer dashboard
 * @param credentials - OAuth 1.0a credentials (apiKey, apiSecret, accessToken, accessTokenSecret)
 * @returns A SubscribeResult indicating success
 * @throws Error if the subscription fails for a reason other than duplicate
 */
export async function subscribeUser(
  webhookId: string,
  credentials: OAuth1Credentials,
): Promise<SubscribeResult> {
  const url = `https://api.twitter.com/2/account_activity/webhooks/${webhookId}/subscriptions/all`;

  const oauth = new OAuth({
    consumer: { key: credentials.apiKey, secret: credentials.apiSecret },
    signature_method: "HMAC-SHA1",
    hash_function: (baseString: string, key: string) =>
      createHmac("sha1", key).update(baseString).digest("base64"),
  });

  const requestData = { url, method: "POST" };
  const token = {
    key: credentials.accessToken,
    secret: credentials.accessTokenSecret,
  };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader.Authorization,
    },
  });

  // 200 = success (new or confirmed subscription)
  if (response.ok) {
    return { subscribed: true, alreadySubscribed: false };
  }

  // Parse error response -- X returns various shapes so try to extract useful info
  const errorText = await response.text().catch(() => "");
  let errorDetail = "";
  try {
    const errorData = JSON.parse(errorText);
    errorDetail =
      errorData?.errors?.[0]?.message ||
      errorData?.detail ||
      errorData?.title ||
      errorText;
  } catch {
    errorDetail = errorText || response.statusText;
  }

  // DuplicateSubscriptionFailed means already subscribed -- treat as success
  if (
    response.status === 400 &&
    errorDetail.includes("DuplicateSubscriptionFailed")
  ) {
    return { subscribed: true, alreadySubscribed: true };
  }

  const hint =
    response.status === 403
      ? " (Account Activity API requires Self-Serve Pro tier or higher)"
      : "";

  throw new Error(
    `X subscription failed (${response.status}): ${errorDetail}${hint}`,
  );
}
