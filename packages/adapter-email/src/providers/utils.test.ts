import { createHmac, randomBytes } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  ValidationError,
} from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import {
  normalizeHeaderKeys,
  parseAddress,
  throwForEspError,
  verifyConstantTimeToken,
  verifySvixRequest,
  verifySvixSignature,
} from "./utils";

const WHSEC_PREFIX = /^whsec_/;
const TEST_SECRET = `whsec_${randomBytes(24).toString("base64")}`;

function makeSvixHeaders(
  body: string,
  secret: string,
  overrides: { id?: string; timestamp?: string } = {}
) {
  const id = overrides.id ?? "msg_test";
  const timestamp =
    overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const secretBytes = Buffer.from(secret.replace(WHSEC_PREFIX, ""), "base64");
  const signed = `${id}.${timestamp}.${body}`;
  const sig = createHmac("sha256", secretBytes)
    .update(signed, "utf8")
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${sig}`,
  };
}

describe("verifySvixSignature", () => {
  it("accepts a valid signature", () => {
    const body = '{"hello":"world"}';
    const headers = makeSvixHeaders(body, TEST_SECRET);
    expect(
      verifySvixSignature({
        id: headers["svix-id"],
        timestamp: headers["svix-timestamp"],
        signatureHeader: headers["svix-signature"],
        body,
        secret: TEST_SECRET,
      })
    ).toBe(true);
  });

  it("rejects when the body is tampered", () => {
    const body = '{"hello":"world"}';
    const headers = makeSvixHeaders(body, TEST_SECRET);
    expect(
      verifySvixSignature({
        id: headers["svix-id"],
        timestamp: headers["svix-timestamp"],
        signatureHeader: headers["svix-signature"],
        body: '{"hello":"WORLD"}',
        secret: TEST_SECRET,
      })
    ).toBe(false);
  });

  it("rejects an unknown signature version", () => {
    expect(
      verifySvixSignature({
        id: "x",
        timestamp: "y",
        signatureHeader: "v0,abc",
        body: "{}",
        secret: TEST_SECRET,
      })
    ).toBe(false);
  });

  it("returns false when the secret cannot be decoded", () => {
    expect(
      verifySvixSignature({
        id: "x",
        timestamp: "y",
        signatureHeader: "v1,abc",
        body: "{}",
        secret: "",
      })
    ).toBe(false);
  });

  it("accepts when one of multiple signatures matches", () => {
    const body = "{}";
    const headers = makeSvixHeaders(body, TEST_SECRET);
    expect(
      verifySvixSignature({
        id: headers["svix-id"],
        timestamp: headers["svix-timestamp"],
        signatureHeader: `v1,xxx ${headers["svix-signature"]}`,
        body,
        secret: TEST_SECRET,
      })
    ).toBe(true);
  });

  it("tolerates a plain (non-prefixed) base64 secret", () => {
    const plain = randomBytes(24).toString("base64");
    const body = "{}";
    const headers = makeSvixHeaders(body, plain);
    expect(
      verifySvixSignature({
        id: headers["svix-id"],
        timestamp: headers["svix-timestamp"],
        signatureHeader: headers["svix-signature"],
        body,
        secret: plain,
      })
    ).toBe(true);
  });
});

describe("verifyConstantTimeToken", () => {
  it("returns true for matching tokens", () => {
    expect(verifyConstantTimeToken("abc123", "abc123")).toBe(true);
  });

  it("returns false for mismatched tokens", () => {
    expect(verifyConstantTimeToken("abc123", "abc124")).toBe(false);
  });

  it("returns false for length mismatches", () => {
    expect(verifyConstantTimeToken("abc", "abcd")).toBe(false);
  });

  it("returns false for null/empty inputs", () => {
    expect(verifyConstantTimeToken(null, "abc")).toBe(false);
    expect(verifyConstantTimeToken(undefined, "abc")).toBe(false);
    expect(verifyConstantTimeToken("", "abc")).toBe(false);
    expect(verifyConstantTimeToken("abc", "")).toBe(false);
  });
});

describe("verifySvixRequest", () => {
  it("returns false when any svix header is missing", () => {
    const req = new Request("https://x", { method: "POST", body: "{}" });
    expect(
      verifySvixRequest({ request: req, body: "{}", secret: TEST_SECRET })
    ).toBe(false);
  });

  it("returns true when all headers are present and valid", () => {
    const body = "{}";
    const headers = makeSvixHeaders(body, TEST_SECRET);
    const req = new Request("https://x", {
      method: "POST",
      headers,
      body,
    });
    expect(verifySvixRequest({ request: req, body, secret: TEST_SECRET })).toBe(
      true
    );
  });
});

describe("throwForEspError", () => {
  it("maps 401 to AuthenticationError", async () => {
    const response = new Response(JSON.stringify({ message: "no" }), {
      status: 401,
    });
    await expect(
      throwForEspError({ response, provider: "X", operation: "send" })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps 403 to AuthenticationError", async () => {
    const response = new Response("{}", { status: 403 });
    await expect(
      throwForEspError({ response, provider: "X", operation: "send" })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps 429 to AdapterRateLimitError with retry-after", async () => {
    const response = new Response("{}", {
      status: 429,
      headers: { "retry-after": "5" },
    });
    const err = await throwForEspError({
      response,
      provider: "X",
      operation: "send",
    }).catch((e) => e as AdapterRateLimitError);
    expect(err).toBeInstanceOf(AdapterRateLimitError);
    expect((err as AdapterRateLimitError).retryAfter).toBe(5);
  });

  it("maps 429 with no retry-after header to AdapterRateLimitError with undefined retry", async () => {
    const response = new Response("{}", { status: 429 });
    const err = await throwForEspError({
      response,
      provider: "X",
      operation: "send",
    }).catch((e) => e as AdapterRateLimitError);
    expect(err).toBeInstanceOf(AdapterRateLimitError);
    expect((err as AdapterRateLimitError).retryAfter).toBeUndefined();
  });

  it("maps 500+ to NetworkError", async () => {
    const response = new Response("boom", { status: 502 });
    await expect(
      throwForEspError({ response, provider: "X", operation: "send" })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("maps 4xx to ValidationError by default", async () => {
    const response = new Response(JSON.stringify({ message: "bad" }), {
      status: 400,
    });
    await expect(
      throwForEspError({ response, provider: "X", operation: "send" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("includes provider and operation in the error message", async () => {
    const response = new Response(JSON.stringify({ message: "nope" }), {
      status: 400,
    });
    await expect(
      throwForEspError({ response, provider: "Foo", operation: "send email" })
    ).rejects.toThrow("Foo send email");
  });

  it("falls back to raw text when the body is not JSON", async () => {
    const response = new Response("plain error text", { status: 400 });
    await expect(
      throwForEspError({ response, provider: "X", operation: "send" })
    ).rejects.toThrow("plain error text");
  });
});

describe("parseAddress", () => {
  it("parses Name <addr@example.com>", () => {
    expect(parseAddress("Alice <alice@example.com>")).toEqual({
      address: "alice@example.com",
      name: "Alice",
    });
  });

  it("parses bare addresses", () => {
    expect(parseAddress("alice@example.com")).toEqual({
      address: "alice@example.com",
    });
  });

  it("strips quotes around display names", () => {
    expect(parseAddress('"Alice Smith" <alice@example.com>')).toEqual({
      address: "alice@example.com",
      name: "Alice Smith",
    });
  });

  it("trims whitespace", () => {
    expect(parseAddress("   alice@example.com  ")).toEqual({
      address: "alice@example.com",
    });
  });

  it("returns just the address when the angle-bracket form has an empty display name", () => {
    expect(parseAddress("<alice@example.com>")).toEqual({
      address: "alice@example.com",
    });
  });
});

describe("normalizeHeaderKeys", () => {
  it("lowercases all keys", () => {
    expect(
      normalizeHeaderKeys({
        "In-Reply-To": "<a@x>",
        References: "<a@x> <b@x>",
      })
    ).toEqual({
      "in-reply-to": "<a@x>",
      references: "<a@x> <b@x>",
    });
  });

  it("returns an empty object for null/undefined input", () => {
    expect(normalizeHeaderKeys(null)).toEqual({});
    expect(normalizeHeaderKeys(undefined)).toEqual({});
  });
});
