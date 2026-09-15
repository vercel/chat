import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";
import { readGmailBody } from "./http";
import { historyId, mailbox } from "./schema";

const bearer = /^Bearer ([^\s]+)$/i;

export class GmailWebhookError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GmailWebhookError";
    this.status = status;
  }
}

const envelope = z.looseObject({
  subscription: z.string().regex(/^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/),
  message: z.looseObject({
    messageId: z.string().min(1).max(256),
    data: z
      .string()
      .regex(/^[a-zA-Z0-9+/_-]+={0,2}$/)
      .max(16_384),
    publishTime: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    orderingKey: z.string().optional(),
  }),
});
const notification = z.object({
  emailAddress: mailbox,
  historyId: z.union([
    historyId,
    z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .transform(String),
  ]),
});

export type GmailEnvelope = z.infer<typeof envelope>;

export interface GmailNotification {
  emailAddress: string;
  envelope: GmailEnvelope;
  historyId: string;
  messageId: string;
  subscription: string;
}

export interface GmailWebhookOptions {
  audience?: string;
  serviceAccountEmail?: string;
  subscription: string;
  verificationKey?: JWTVerifyGetKey;
  webhookVerifier?: (request: Request) => unknown | Promise<unknown>;
}

export function parseGmailNotification(body: string): GmailNotification {
  try {
    const payload = envelope.parse(JSON.parse(body));
    const data = notification.parse(
      JSON.parse(Buffer.from(payload.message.data, "base64").toString("utf8"))
    );
    return {
      ...data,
      messageId: payload.message.messageId,
      subscription: payload.subscription,
      envelope: payload,
    };
  } catch {
    throw new GmailWebhookError(400, "Invalid Gmail Pub/Sub notification");
  }
}

export function createGmailWebhookVerifier(
  options: GmailWebhookOptions
): (request: Request) => Promise<GmailNotification> {
  const verifier = options.webhookVerifier;
  const audience = verifier
    ? undefined
    : z.string().min(1).parse(options.audience);
  const serviceAccountEmail = verifier
    ? undefined
    : mailbox.parse(options.serviceAccountEmail);
  const subscription = envelope.shape.subscription.parse(options.subscription);
  const key =
    options.verificationKey ??
    createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return async (request) => {
    if (request.method !== "POST") {
      throw new GmailWebhookError(405, "Gmail notifications require POST");
    }
    if (verifier) {
      let body: string;
      try {
        body = await readGmailBody(new Response(request.body), 32_768);
      } catch {
        throw new GmailWebhookError(400, "Invalid Gmail Pub/Sub body");
      }
      try {
        if (!(await verifier(new Request(request, { body })))) {
          throw new Error("Rejected");
        }
      } catch {
        throw new GmailWebhookError(
          401,
          "Gmail webhook verifier rejected the request"
        );
      }
      const notification = parseGmailNotification(body);
      if (notification.subscription !== subscription) {
        throw new GmailWebhookError(403, "Unexpected Pub/Sub subscription");
      }
      return notification;
    }
    const token = bearer.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) {
      throw new GmailWebhookError(401, "Missing Pub/Sub authentication");
    }
    try {
      const { payload } = await jwtVerify(token, key, {
        audience,
        issuer: ["accounts.google.com", "https://accounts.google.com"],
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub", "email", "email_verified"],
      });
      if (
        payload.email !== serviceAccountEmail ||
        payload.email_verified !== true
      ) {
        throw new Error("Unexpected Pub/Sub identity");
      }
    } catch {
      throw new GmailWebhookError(401, "Invalid Pub/Sub authentication");
    }
    let notification: GmailNotification;
    try {
      notification = parseGmailNotification(
        await readGmailBody(new Response(request.body), 32_768)
      );
    } catch (error) {
      if (error instanceof GmailWebhookError) {
        throw error;
      }
      throw new GmailWebhookError(400, "Invalid Gmail Pub/Sub body");
    }
    if (notification.subscription !== subscription) {
      throw new GmailWebhookError(403, "Unexpected Pub/Sub subscription");
    }
    return notification;
  };
}
