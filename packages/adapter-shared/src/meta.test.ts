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
  throwMetaGraphApiError,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "./meta";

const SECRET = "app-secret";
const BODY = '{"object":"page"}';

function flipLastHexDigit(signature: string): string {
  const last = signature.at(-1);
  return `${signature.slice(0, -1)}${last === "0" ? "1" : "0"}`;
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function challengeParams(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe("verifyMetaWebhookChallenge", () => {
  it("returns the challenge when mode and token match", () => {
    const params = challengeParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
      "hub.challenge": "abc",
    });
    expect(verifyMetaWebhookChallenge(params, "token")).toBe("abc");
  });

  it("returns an empty string when the challenge is missing", () => {
    const params = challengeParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "token",
    });
    expect(verifyMetaWebhookChallenge(params, "token")).toBe("");
  });

  it("returns null for a wrong token", () => {
    const params = challengeParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "abc",
    });
    expect(verifyMetaWebhookChallenge(params, "token")).toBeNull();
  });

  it("returns null for a wrong mode", () => {
    const params = challengeParams({
      "hub.mode": "unsubscribe",
      "hub.verify_token": "token",
      "hub.challenge": "abc",
    });
    expect(verifyMetaWebhookChallenge(params, "token")).toBeNull();
  });
});

describe("verifyMetaSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("accepts a valid signature in uppercase hex", () => {
    const hash = sign(BODY).slice("sha256=".length).toUpperCase();
    expect(verifyMetaSignature(BODY, `sha256=${hash}`, SECRET)).toBe(true);
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
    ["with leading characters", `x${sign(BODY)}`],
    ["with another algorithm", sign(BODY).replace("sha256", "sha1")],
    ["truncated", sign(BODY).slice(0, -2)],
    ["one hex digit too long", `${sign(BODY)}0`],
    ["two hex digits too long", `${sign(BODY)}00`],
    ["one flipped digit", flipLastHexDigit(sign(BODY))],
    ["non-hex", "sha256=zz"],
  ])("rejects a %s signature", (_label, signature) => {
    expect(verifyMetaSignature(BODY, signature, SECRET)).toBe(false);
  });
});

describe("throwMetaGraphApiError", () => {
  function run(
    status: number,
    error?: Record<string, unknown>,
    retryAfter?: number
  ) {
    try {
      throwMetaGraphApiError({
        adapter: "messenger",
        data: error ? { error } : {},
        endpoint: "me/messages",
        label: "Messenger",
        retryAfter,
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
    [429, { code: 190 }],
    [401, { code: 4 }],
    [403, { code: 32 }],
    [404, { code: 613 }],
  ])("maps status %d with %j to a rate-limit error", (status, error) => {
    const thrown = run(status, error, 12);
    expect(thrown).toBeInstanceOf(AdapterRateLimitError);
    expect((thrown as AdapterRateLimitError).adapter).toBe("messenger");
    expect((thrown as AdapterRateLimitError).retryAfter).toBe(12);
  });

  it("leaves retryAfter unset when the response had no usable header", () => {
    const thrown = run(429);
    expect(thrown).toBeInstanceOf(AdapterRateLimitError);
    expect((thrown as AdapterRateLimitError).retryAfter).toBeUndefined();
  });

  it.each([
    [401, undefined, "Messenger API me/messages failed"],
    [400, { code: 190, message: "Token expired" }, "Token expired"],
    [401, { code: 10, message: "Not permitted" }, "Not permitted"],
    [403, { code: 190, message: "Token expired" }, "Token expired"],
    [404, { code: 190, message: "Token expired" }, "Token expired"],
  ])("maps status %d with %j to an authentication error", (status, error, message) => {
    const thrown = run(status, error, 12);
    expect(thrown).toBeInstanceOf(AuthenticationError);
    expect((thrown as AuthenticationError).adapter).toBe("messenger");
    expect((thrown as AuthenticationError).message).toBe(message);
  });

  it.each([
    [403, undefined, "Messenger API me/messages failed"],
    [400, { code: 10, message: "Not permitted" }, "Not permitted"],
    [400, { code: 200, message: "Needs permission" }, "Needs permission"],
    [404, { code: 10, message: "Not permitted" }, "Not permitted"],
  ])("maps status %d with %j to a validation error", (status, error, message) => {
    const thrown = run(status, error, 12);
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).adapter).toBe("messenger");
    expect((thrown as ValidationError).message).toBe(message);
  });

  it.each([
    [undefined],
    [{ code: 100, message: "Unsupported get request" }],
  ])("maps 404 with %j to a not-found error for the endpoint", (error) => {
    const thrown = run(404, error, 12);
    expect(thrown).toBeInstanceOf(ResourceNotFoundError);
    expect((thrown as ResourceNotFoundError).adapter).toBe("messenger");
    expect((thrown as ResourceNotFoundError).resourceType).toBe("me/messages");
    expect((thrown as ResourceNotFoundError).resourceId).toBeUndefined();
  });

  it("maps other failures to a network error with the Meta message", () => {
    const thrown = run(500, { code: 1, message: "Unknown error" });
    expect(thrown).toBeInstanceOf(NetworkError);
    expect((thrown as NetworkError).adapter).toBe("messenger");
    expect((thrown as Error).message).toBe(
      "Unknown error (status 500, code 1)"
    );
  });

  it("falls back to a labeled message when Meta sends none", () => {
    const thrown = run(500);
    expect(thrown).toBeInstanceOf(NetworkError);
    expect((thrown as Error).message).toBe(
      "Messenger API me/messages failed (status 500, code 500)"
    );
  });

  it("uses the HTTP status as the code when the error body has none", () => {
    const thrown = run(502, { message: "Bad gateway" });
    expect(thrown).toBeInstanceOf(NetworkError);
    expect((thrown as Error).message).toBe(
      "Bad gateway (status 502, code 502)"
    );
  });
});
