import { resolveTwilioCredential } from "../api";
import type {
  TwilioVerifiedRequest,
  TwilioVerifyOptions,
  TwilioWebhookUrl,
} from "./types";
import { TwilioWebhookVerificationError } from "./types";

export async function verifyTwilioRequest(
  request: Request,
  options: TwilioVerifyOptions = {}
): Promise<TwilioVerifiedRequest> {
  const body = await request.text();
  if (options.webhookVerifier) {
    const result = await options.webhookVerifier(request, body);
    if (!result) {
      throw new TwilioWebhookVerificationError(
        "Twilio webhook verifier rejected the request"
      );
    }
    return {
      body: typeof result === "string" ? result : body,
      params: paramsForRequest(
        request,
        typeof result === "string" ? result : body
      ),
    };
  }
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) {
    throw new TwilioWebhookVerificationError(
      "Twilio signature header is required"
    );
  }
  const authToken = await resolveTwilioCredential(
    options.authToken,
    "TWILIO_AUTH_TOKEN"
  );
  const url = await resolveTwilioWebhookUrl(request, options.webhookUrl);
  const params = paramsForRequest(request, body);
  const signedParams = request.method.toUpperCase() === "GET" ? null : params;
  const expected = await signTwilioRequest({
    authToken,
    params: signedParams,
    url,
  });
  if (!constantTimeEqual(expected, signature)) {
    throw new TwilioWebhookVerificationError("Twilio signature is invalid");
  }
  return { body, params };
}

export async function signTwilioRequest(input: {
  authToken: string;
  params?: URLSearchParams | null;
  url: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.authToken),
    { hash: "SHA-1", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(twilioSignatureBase(input.url, input.params))
  );
  return base64(signature);
}

export function twilioSignatureBase(
  url: string,
  params?: URLSearchParams | null
): string {
  if (!params) {
    return url;
  }
  let base = url;
  const grouped = new Map<string, Set<string>>();
  for (const [name, value] of params) {
    const values = grouped.get(name) ?? new Set<string>();
    values.add(value);
    grouped.set(name, values);
  }
  for (const name of [...grouped.keys()].sort()) {
    for (const value of [...(grouped.get(name) ?? [])].sort()) {
      base += `${name}${value}`;
    }
  }
  return base;
}

export async function resolveTwilioWebhookUrl(
  request: Request,
  webhookUrl: TwilioWebhookUrl | undefined
): Promise<string> {
  if (typeof webhookUrl === "function") {
    return webhookUrl(request);
  }
  return webhookUrl ?? request.url;
}

function paramsForRequest(request: Request, body: string): URLSearchParams {
  if (request.method.toUpperCase() === "GET") {
    return new URL(request.url).searchParams;
  }
  return new URLSearchParams(body);
}

function base64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string): boolean {
  let differences = Math.abs(left.length - right.length);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftCode = left.charCodeAt(index) || 0;
    const rightCode = right.charCodeAt(index) || 0;
    differences += Number(leftCode !== rightCode);
  }
  return differences === 0;
}
