import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  ResourceNotFoundError,
  ValidationError,
} from "./errors";
import {
  parseRetryAfter,
  throwMetaGraphApiError,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "./meta";

const SECRET = "app-secret";
const BODY = '{"object":"page"}';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function challengeRequest(params: Record<string, string>): Request {
  const url = new URL("https://example.com/webhook");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

describe("verifyMetaWebhookChallenge", () => {
  it("returns the challenge when mode and token match", () => {
    const request = challengeRequest({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
      "hub.challenge": "abc",
    });
    expect(verifyMetaWebhookChallenge(request, "token")).toBe("abc");
  });

  it("returns an empty string when the challenge is missing", () => {
    const request = challengeRequest({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
    });
    expect(verifyMetaWebhookChallenge(request, "token")).toBe("");
  });

  it("returns null for a wrong token", () => {
    const request = challengeRequest({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "abc",
    });
    expect(verifyMetaWebhookChallenge(request, "token")).toBeNull();
  });

  it("returns null for a wrong mode", () => {
    const request = challengeRequest({
      "hub.mode": "unsubscribe",
      "hub.verify_token": "token",
      "hub.challenge": "abc",
    });
    expect(verifyMetaWebhookChallenge(request, "token")).toBeNull();
  });
});

describe("verifyMetaSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, "other"), SECRET)).toBe(false);
  });

  it("rejects a signature for another body", () => {
    expect(verifyMetaSignature(BODY, sign("{}"), SECRET)).toBe(false);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["without prefix", sign(BODY).slice("sha256=".length)],
    ["with another algorithm", sign(BODY).replace("sha256", "sha1")],
    ["truncated", sign(BODY).slice(0, -2)],
    ["non-hex", "sha256=zz"],
  ])("rejects a %s signature", (_label, signature) => {
    expect(verifyMetaSignature(BODY, signature, SECRET)).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it.each([
    [null, undefined],
    ["", undefined],
    ["0", undefined],
    ["-5", undefined],
    ["soon", undefined],
    ["30", 30],
  ])("parses %j as %j", (value, expected) => {
    expect(parseRetryAfter(value)).toBe(expected);
  });
});

describe("throwMetaGraphApiError", () => {
  function run(status: number, error?: Record<string, unknown>) {
    try {
      throwMetaGraphApiError({
        adapter: "messenger",
        data: error ? { error } : {},
        endpoint: "me/messages",
        label: "Messenger",
        retryAfter: 12,
        status,
      });
    } catch (thrown) {
      return thrown;
    }
    throw new Error("expected throwMetaGraphApiError to throw");
  }

  it.each([
    [429, undefined],
    [400, { code: 4 }],
    [400, { code: 32 }],
    [400, { code: 613 }],
  ])("maps status %d with %j to a rate-limit error", (status, error) => {
    const thrown = run(status, error);
    expect(thrown).toBeInstanceOf(AdapterRateLimitError);
    expect((thrown as AdapterRateLimitError).retryAfter).toBe(12);
  });

  it.each([
    [401, undefined],
    [400, { code: 190, message: "Token expired" }],
  ])("maps status %d with %j to an authentication error", (status, error) => {
    expect(run(status, error)).toBeInstanceOf(AuthenticationError);
  });

  it.each([
    [403, undefined],
    [400, { code: 10 }],
    [400, { code: 200 }],
  ])("maps status %d with %j to a validation error", (status, error) => {
    expect(run(status, error)).toBeInstanceOf(ValidationError);
  });

  it("maps 404 to a not-found error", () => {
    expect(run(404)).toBeInstanceOf(ResourceNotFoundError);
  });

  it("maps other failures to a network error with the Meta message", () => {
    const thrown = run(500, { code: 1, message: "Unknown error" });
    expect(thrown).toBeInstanceOf(NetworkError);
    expect((thrown as Error).message).toBe(
      "Unknown error (status 500, code 1)"
    );
  });

  it("falls back to a labeled message when Meta sends none", () => {
    const thrown = run(500);
    expect((thrown as Error).message).toBe(
      "Messenger API me/messages failed (status 500, code 500)"
    );
  });
});
