import { generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createGmailWebhookVerifier, parseGmailNotification } from "./webhook";

const audience = "https://example.com/gmail";
const subscription = "projects/project/subscriptions/mail";
const email = "push@project.iam.gserviceaccount.com";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;

function body(
  destination = subscription,
  historyId: string | number = "9007199254740993"
): string {
  return JSON.stringify({
    subscription: destination,
    message: {
      messageId: "delivery",
      publishTime: "2020-01-01T00:00:00Z",
      data: Buffer.from(
        JSON.stringify({
          emailAddress: "agent@example.com",
          historyId,
        })
      ).toString("base64"),
    },
  });
}

function token(payload: JWTPayload = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: "https://accounts.google.com",
    aud: audience,
    sub: "123456789",
    iat: now - 1800,
    exp: now + 1800,
    email,
    email_verified: true,
    ...payload,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey);
}

function verifier() {
  return createGmailWebhookVerifier({
    audience,
    serviceAccountEmail: email,
    subscription,
    verificationKey: () => Promise.resolve(keys.publicKey),
  });
}

function request(authorization: string, content = body()): Request {
  return new Request(audience, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authorization}`,
      "content-type": "application/json",
    },
    body: content,
  });
}

describe("Gmail Pub/Sub primitives", () => {
  beforeAll(async () => {
    keys = await generateKeyPair("RS256");
  });

  it("verifies signed identity and allows redeliveries with an older publication time", async () => {
    const verify = verifier();
    await expect(verify(request(await token()))).resolves.toEqual({
      emailAddress: "agent@example.com",
      historyId: "9007199254740993",
      messageId: "delivery",
      subscription,
      envelope: JSON.parse(body()),
    });
  });

  it("normalizes numeric history ids from live Gmail notifications", async () => {
    await expect(
      verifier()(request(await token(), body(subscription, 1234567890)))
    ).resolves.toMatchObject({ historyId: "1234567890" });
  });

  it.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid or imprecise numeric history ids: %s", async (historyId) => {
    await expect(
      verifier()(request(await token(), body(subscription, historyId)))
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { aud: "https://another.example.com/gmail" },
    { iss: "https://attacker.example" },
    { email: "gmail-api-push@system.gserviceaccount.com" },
    { email_verified: false },
    { email_verified: "true" },
    { exp: 1 },
    { sub: undefined },
  ])("rejects mismatched or missing signed claims: %j", async (claims) => {
    await expect(
      verifier()(request(await token(claims)))
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a signature made with another key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email, email_verified: true })
      .setProtectedHeader({ alg: "RS256" })
      .setAudience(audience)
      .setIssuer("https://accounts.google.com")
      .setSubject("123456789")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(other.privateKey);
    await expect(verifier()(request(forged))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects an unauthenticated request before parsing its body", async () => {
    const incoming = new Request(audience, {
      method: "POST",
      body: "not json",
    });
    await expect(verifier()(incoming)).rejects.toMatchObject({ status: 401 });
    expect(incoming.bodyUsed).toBe(false);
  });

  it("rejects another subscription even with valid signed identity", async () => {
    await expect(
      verifier()(
        request(await token(), body("projects/project/subscriptions/other"))
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    "not json",
    "{}",
    "x".repeat(32_769),
  ])("bounds and validates the notification body", async (content) => {
    await expect(
      verifier()(request(await token(), content))
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps parsing separate from transport verification", () => {
    expect(parseGmailNotification(body()).messageId).toBe("delivery");
    expect(() => parseGmailNotification("{")).toThrow(
      "Invalid Gmail Pub/Sub notification"
    );
  });

  it("preserves the provider envelope for caller-owned event handling", async () => {
    const payload = {
      ...JSON.parse(body()),
      deliveryAttempt: 2,
    };
    payload.message.attributes = { source: "mailbox" };
    payload.message.orderingKey = "account";
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      const result = await verifier()(
        request(await token(), JSON.stringify(payload))
      );
      expect(result).toMatchObject({
        emailAddress: "agent@example.com",
        historyId: "9007199254740993",
        envelope: payload,
      });
      expect(JSON.parse(JSON.stringify(result)).envelope).toEqual(payload);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("rejects malformed provider attributes even with valid transport identity", async () => {
    const payload = JSON.parse(body());
    payload.message.attributes = { source: 123 };
    await expect(
      verifier()(request(await token(), JSON.stringify(payload)))
    ).rejects.toMatchObject({ status: 400 });
  });
});
