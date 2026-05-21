import { parseSlackWebhookBody } from "./parse";
import {
  type SlackHeaders,
  type SlackReadOptions,
  type SlackVerifyOptions,
  type SlackWebhookPayload,
  SlackWebhookVerificationError,
} from "./types";
import { getHeader } from "./utils";

const HEX_PATTERN = /^[\da-f]+$/i;

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

  const verified = await verifySlackSignatureValue(
    body,
    signingSecret,
    timestamp,
    signature
  );
  if (!verified) {
    throw new SlackWebhookVerificationError("Slack signature is invalid");
  }
}

async function verifySlackSignatureValue(
  body: string,
  signingSecret: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
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
    ["verify"]
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    parseSlackSignature(signature),
    encoder.encode(`v0:${timestamp}:${body}`)
  );
}

function parseSlackSignature(signature: string): ArrayBuffer {
  if (!signature.startsWith("v0=")) {
    throw new SlackWebhookVerificationError("Slack signature is invalid");
  }

  const hex = signature.slice(3);
  if (hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
    throw new SlackWebhookVerificationError("Slack signature is invalid");
  }

  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return buffer;
}
