export type {
  GoogleChatAddedToSpacePayload,
  GoogleChatCardClickedPayload,
  GoogleChatContinuation,
  GoogleChatEvent,
  GoogleChatFormInput,
  GoogleChatFormInputs,
  GoogleChatMessage,
  GoogleChatMessagePayload,
  GoogleChatPayloadBase,
  GoogleChatReaction,
  GoogleChatRemovedFromSpacePayload,
  GoogleChatSpace,
  GoogleChatUnsupportedPayload,
  GoogleChatUser,
  GoogleChatWebhookPayload,
  GoogleChatWorkspaceMessagePayload,
  GoogleChatWorkspaceReactionPayload,
  PubSubPushMessage,
  WorkspaceEventNotification,
} from "./types";

import type {
  GoogleChatEvent,
  GoogleChatFormInputs,
  GoogleChatWebhookPayload,
  PubSubPushMessage,
  WorkspaceEventNotification,
} from "./types";

const ALLOWED_WORKSPACE_EVENT_TYPES = new Set([
  "google.workspace.chat.message.v1.created",
  "google.workspace.chat.reaction.v1.created",
  "google.workspace.chat.reaction.v1.deleted",
]);

export interface GoogleChatTokenVerificationResult {
  audience?: string;
  email?: string;
  issuer?: string;
  subject?: string;
}

export type GoogleChatTokenVerifier = (
  token: string,
  expectedAudience: string
) =>
  | Promise<boolean | GoogleChatTokenVerificationResult>
  | boolean
  | GoogleChatTokenVerificationResult;

export interface GoogleChatWebhookOptions {
  /** Accept requests without a token verifier. Only use for local development. */
  disableSignatureVerification?: boolean;
  /** Expected JWT audience for direct Google Chat webhooks. */
  googleChatProjectNumber?: string;
  /** Expected JWT audience for Pub/Sub push webhooks. */
  pubsubAudience?: string;
  /** Verifier for Google-signed bearer tokens. */
  tokenVerifier?: GoogleChatTokenVerifier;
}

export async function verifyGoogleChatBearerToken(
  request: Request,
  expectedAudience: string,
  verifier: GoogleChatTokenVerifier
): Promise<GoogleChatTokenVerificationResult> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;

  if (!token) {
    throw new Error("Missing Google Chat bearer token");
  }

  const result = await verifier(token, expectedAudience);
  if (result === false) {
    throw new Error("Invalid Google Chat bearer token");
  }

  if (result === true) {
    return { audience: expectedAudience };
  }

  if (result.audience && result.audience !== expectedAudience) {
    throw new Error("Invalid Google Chat bearer token audience");
  }

  return result;
}

export async function readGoogleChatWebhook(
  request: Request,
  options: GoogleChatWebhookOptions = {}
): Promise<GoogleChatWebhookPayload> {
  const body = await request.json();
  const isPubSub = isGoogleChatPubSubPushMessage(body);
  const expectedAudience = isPubSub
    ? options.pubsubAudience
    : options.googleChatProjectNumber;

  if (expectedAudience && options.tokenVerifier) {
    await verifyGoogleChatBearerToken(
      request,
      expectedAudience,
      options.tokenVerifier
    );
  } else if (!options.disableSignatureVerification) {
    throw new Error(
      isPubSub
        ? "Pub/Sub audience and tokenVerifier are required"
        : "Google Chat project number and tokenVerifier are required"
    );
  }

  return parseGoogleChatWebhookBody(body);
}

export function parseGoogleChatWebhookBody(
  body: unknown
): GoogleChatWebhookPayload {
  if (isGoogleChatPubSubPushMessage(body)) {
    const eventType = body.message.attributes?.["ce-type"];
    if (eventType && !ALLOWED_WORKSPACE_EVENT_TYPES.has(eventType)) {
      return {
        kind: "unsupported",
        raw: body,
        reason: `Unsupported Workspace Events type: ${eventType}`,
      };
    }

    const notification = decodeGoogleChatPubSubMessage(body);
    if (notification.message) {
      return {
        continuation: extractGoogleChatContinuation(notification),
        kind: "workspace_message",
        message: notification.message,
        notification,
        raw: body,
      };
    }

    if (notification.reaction) {
      return {
        continuation: extractGoogleChatContinuation(notification),
        kind: "workspace_reaction",
        notification,
        raw: body,
        reaction: notification.reaction,
      };
    }

    return {
      kind: "unsupported",
      raw: body,
      reason:
        "Workspace Events notification did not include a message or reaction",
    };
  }

  const event = body as GoogleChatEvent;
  const addedPayload = event.chat?.addedToSpacePayload;
  if (addedPayload) {
    return {
      continuation: extractGoogleChatContinuation(event),
      kind: "added_to_space",
      raw: body,
      space: addedPayload.space,
    };
  }

  const removedPayload = event.chat?.removedFromSpacePayload;
  if (removedPayload) {
    return {
      continuation: extractGoogleChatContinuation(event),
      kind: "removed_from_space",
      raw: body,
      space: removedPayload.space,
    };
  }

  const buttonPayload = event.chat?.buttonClickedPayload;
  const invokedFunction = event.commonEventObject?.invokedFunction;
  if (buttonPayload || invokedFunction) {
    const actionId =
      event.commonEventObject?.parameters?.actionId ?? invokedFunction;
    return {
      actionId,
      continuation: extractGoogleChatContinuation(event),
      kind: "card_clicked",
      message: buttonPayload?.message,
      parameters: event.commonEventObject?.parameters,
      raw: body,
      space: buttonPayload?.space,
      user: buttonPayload?.user ?? event.chat?.user,
      value: actionId
        ? getGoogleChatFormInputValue(
            event.commonEventObject?.formInputs,
            actionId
          )
        : undefined,
    };
  }

  const messagePayload = event.chat?.messagePayload;
  if (messagePayload) {
    return {
      continuation: extractGoogleChatContinuation(event),
      kind: "message",
      message: messagePayload.message,
      raw: body,
      space: messagePayload.space,
    };
  }

  return {
    kind: "unsupported",
    raw: body,
    reason: "Unsupported Google Chat webhook payload",
  };
}

export function decodeGoogleChatPubSubMessage(
  pushMessage: PubSubPushMessage
): WorkspaceEventNotification {
  const data = Buffer.from(pushMessage.message.data, "base64").toString(
    "utf-8"
  );
  const payload = JSON.parse(data) as Pick<
    WorkspaceEventNotification,
    "message" | "reaction"
  >;
  const attributes = pushMessage.message.attributes ?? {};

  return {
    eventTime: attributes["ce-time"] ?? pushMessage.message.publishTime,
    eventType: attributes["ce-type"] ?? "",
    message: payload.message,
    reaction: payload.reaction,
    subscription: pushMessage.subscription,
    targetResource: attributes["ce-subject"] ?? "",
  };
}

export function extractGoogleChatContinuation(
  event: GoogleChatEvent | WorkspaceEventNotification
) {
  if ("targetResource" in event) {
    const message = event.message;
    const spaceName =
      event.targetResource.replace("//chat.googleapis.com/", "") ||
      message?.space?.name ||
      "";
    return {
      messageName: message?.name,
      spaceName,
      threadName: message?.thread?.name ?? message?.name,
      transport: "pubsub" as const,
    };
  }

  const message =
    event.chat?.messagePayload?.message ??
    event.chat?.buttonClickedPayload?.message;
  const space =
    event.chat?.messagePayload?.space ??
    event.chat?.buttonClickedPayload?.space ??
    event.chat?.addedToSpacePayload?.space ??
    event.chat?.removedFromSpacePayload?.space;

  return space
    ? {
        isDM:
          space.type === "DM" ||
          space.spaceType === "DIRECT_MESSAGE" ||
          space.singleUserBotDm === true,
        messageName: message?.name,
        spaceName: space.name,
        threadName: message?.thread?.name ?? message?.name,
        transport: "direct" as const,
      }
    : undefined;
}

export function parseGoogleChatFormInputs(
  formInputs: GoogleChatFormInputs | undefined
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, input] of Object.entries(formInputs ?? {})) {
    const value = input.stringInputs?.value?.[0];
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

export function getGoogleChatFormInputValue(
  formInputs: GoogleChatFormInputs | undefined,
  actionId: string
): string | undefined {
  return parseGoogleChatFormInputs(formInputs)[actionId];
}

function isGoogleChatPubSubPushMessage(
  body: unknown
): body is PubSubPushMessage {
  return (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    "subscription" in body &&
    typeof (body as PubSubPushMessage).message?.data === "string"
  );
}
