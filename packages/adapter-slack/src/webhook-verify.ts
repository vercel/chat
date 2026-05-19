import { parseSlackWebhookBody } from "./webhook-parse";
import {
  type SlackHeaders,
  type SlackReadOptions,
  type SlackVerifyOptions,
  type SlackWebhookPayload,
  SlackWebhookVerificationError,
} from "./webhook-types";
import { constantTimeStringEqual, getHeader, toHex } from "./webhook-utils";

export async function readSlackWebhook(
  request: Request,
  options: SlackReadOptions
): Promise<SlackWebhookPayload> {
  const body = await verifySlackRequest(request, options);
  return parseSlackWebhookBody(body, {
    contentType: options.contentType,
    headers: request.headers,
  });
}

export async function verifySlackRequest(
  request: Request,
  options: SlackVerifyOptions
): Promise<string> {
  const body = await request.text();
  if (options.webhookVerifier) {
    const result = await options.webhookVerifier(request, body);
    if (!result) {
      throw new SlackWebhookVerificationError(
        "Slack webhook verifier rejected the request"
      );
    }
    return typeof result === "string" ? result : body;
  }

  await verifySlackSignature(body, request.headers, options);
  return body;
}

export async function verifySlackSignature(
  body: string,
  headers: SlackHeaders,
  options: SlackVerifyOptions
): Promise<void> {
  const signingSecret = options.signingSecret;
  if (!signingSecret) {
    throw new SlackWebhookVerificationError("Slack signing secret is required");
  }

  const timestamp = getHeader(headers, "x-slack-request-timestamp");
  const signature = getHeader(headers, "x-slack-signature");
  if (!(timestamp && signature)) {
    throw new SlackWebhookVerificationError(
      "Slack signature headers are required"
    );
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new SlackWebhookVerificationError("Slack timestamp is invalid");
  }

  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const maxSkewSeconds = options.maxSkewSeconds ?? 300;
  if (Math.abs(now - timestampSeconds) > maxSkewSeconds) {
    throw new SlackWebhookVerificationError("Slack timestamp is too old");
  }

  const expected = await createSlackSignature(body, signingSecret, timestamp);
  if (!constantTimeStringEqual(expected, signature)) {
    throw new SlackWebhookVerificationError("Slack signature is invalid");
  }
}

async function createSlackSignature(
  body: string,
  signingSecret: string,
  timestamp: string
): Promise<string> {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new SlackWebhookVerificationError("Web Crypto is not available");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`v0:${timestamp}:${body}`)
  );
  return `v0=${toHex(new Uint8Array(signature))}`;
}
