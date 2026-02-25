/**
 * Google Workspace Events API integration for receiving all messages in a space.
 *
 * By default, Google Chat only sends webhooks for @mentions. To receive ALL messages
 * in a space, you need to create a Workspace Events subscription that publishes to
 * a Pub/Sub topic, which then pushes to your webhook endpoint.
 *
 * Setup flow:
 * 1. Create a Pub/Sub topic in your GCP project
 * 2. Create a Pub/Sub push subscription pointing to your /api/webhooks/gchat/pubsub endpoint
 * 3. Call createSpaceSubscription() to subscribe to message events for a space
 * 4. Handle Pub/Sub messages in your webhook with handlePubSubMessage()
 */

import {
  auth as googleAuth,
  workspaceevents,
} from "@googleapis/workspaceevents";
import type { GoogleChatMessage } from "./index";

/** Options for creating a space subscription */
export interface CreateSpaceSubscriptionOptions {
  /** The Pub/Sub topic to receive events (e.g., "projects/my-project/topics/my-topic") */
  pubsubTopic: string;
  /** The space name (e.g., "spaces/AAAA...") */
  spaceName: string;
  /** Optional TTL for the subscription in seconds (default: 1 day, max: 1 day for Chat) */
  ttlSeconds?: number;
}

/** Result of creating a space subscription */
export interface SpaceSubscriptionResult {
  /** When the subscription expires (ISO 8601) */
  expireTime: string;
  /** The subscription resource name */
  name: string;
}

/** Pub/Sub push message wrapper (what Google sends to your endpoint) */
export interface PubSubPushMessage {
  message: {
    /** Base64 encoded event data */
    data: string;
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

/** Google Chat reaction data */
export interface GoogleChatReaction {
  /** The emoji */
  emoji?: {
    unicode?: string;
  };
  /** Reaction resource name */
  name: string;
  /** The user who added/removed the reaction */
  user?: {
    name: string;
    displayName?: string;
    type?: string;
  };
}

/** Decoded Workspace Events notification payload */
export interface WorkspaceEventNotification {
  /** When the event occurred */
  eventTime: string;
  /** Event type (e.g., "google.workspace.chat.message.v1.created") */
  eventType: string;
  /** Present for message.created events */
  message?: GoogleChatMessage;
  /** Present for reaction.created/deleted events */
  reaction?: GoogleChatReaction;
  /** Space info */
  space?: {
    name: string;
    type: string;
  };
  /** The subscription that triggered this event */
  subscription: string;
  /** The resource being watched (e.g., "//chat.googleapis.com/spaces/AAAA") */
  targetResource: string;
}

/** Service account credentials for authentication */
export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** Auth options - service account, ADC, or custom auth client */
export type WorkspaceEventsAuthOptions =
  | { credentials: ServiceAccountCredentials; impersonateUser?: string }
  | { useApplicationDefaultCredentials: true; impersonateUser?: string }
  | { auth: Parameters<typeof workspaceevents>[0]["auth"] };

/**
 * Create a Workspace Events subscription to receive all messages in a Chat space.
 *
 * Prerequisites:
 * - Enable the "Google Workspace Events API" in your GCP project
 * - Create a Pub/Sub topic and grant the Chat service account publish permissions
 * - The calling user/service account needs permission to access the space
 *
 * @example
 * ```typescript
 * const result = await createSpaceSubscription({
 *   spaceName: "spaces/AAAAxxxxxx",
 *   pubsubTopic: "projects/my-project/topics/chat-events",
 * }, {
 *   credentials: {
 *     client_email: "...",
 *     private_key: "...",
 *   }
 * });
 * ```
 */
export async function createSpaceSubscription(
  options: CreateSpaceSubscriptionOptions,
  auth: WorkspaceEventsAuthOptions
): Promise<SpaceSubscriptionResult> {
  const { spaceName, pubsubTopic, ttlSeconds = 86400 } = options; // Default 1 day

  // Set up auth
  let authClient: Parameters<typeof workspaceevents>[0]["auth"];

  if ("credentials" in auth) {
    authClient = new googleAuth.JWT({
      email: auth.credentials.client_email,
      key: auth.credentials.private_key,
      // For domain-wide delegation, impersonate a user
      subject: auth.impersonateUser,
      scopes: [
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.messages.readonly",
      ],
    });
  } else if ("useApplicationDefaultCredentials" in auth) {
    authClient = new googleAuth.GoogleAuth({
      // Note: ADC with impersonation requires different setup
      scopes: [
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.messages.readonly",
      ],
    });
  } else {
    // Custom auth client (e.g., Vercel OIDC)
    authClient = auth.auth;
  }

  const workspaceEvents = workspaceevents({
    version: "v1",
    auth: authClient,
  });

  // Create the subscription
  const response = await workspaceEvents.subscriptions.create({
    requestBody: {
      targetResource: `//chat.googleapis.com/${spaceName}`,
      eventTypes: [
        "google.workspace.chat.message.v1.created",
        "google.workspace.chat.message.v1.updated",
        "google.workspace.chat.reaction.v1.created",
        "google.workspace.chat.reaction.v1.deleted",
      ],
      notificationEndpoint: {
        pubsubTopic,
      },
      payloadOptions: {
        includeResource: true,
      },
      ttl: `${ttlSeconds}s`,
    },
  });

  // The create operation returns a long-running operation
  // For simplicity, we'll return the operation name - in production you might want to poll for completion
  const operation = response.data;

  if (operation.done && operation.response) {
    const subscription = operation.response as {
      name?: string;
      expireTime?: string;
    };
    return {
      name: subscription.name || "",
      expireTime: subscription.expireTime || "",
    };
  }

  // Operation is still pending - return operation name
  // The subscription will be created asynchronously
  return {
    name: operation.name || "pending",
    expireTime: "",
  };
}

/**
 * List active subscriptions for a target resource.
 */
export async function listSpaceSubscriptions(
  spaceName: string,
  auth: WorkspaceEventsAuthOptions
): Promise<Array<{ name: string; expireTime: string; eventTypes: string[] }>> {
  let authClient: Parameters<typeof workspaceevents>[0]["auth"];

  if ("credentials" in auth) {
    authClient = new googleAuth.JWT({
      email: auth.credentials.client_email,
      key: auth.credentials.private_key,
      subject: auth.impersonateUser,
      scopes: ["https://www.googleapis.com/auth/chat.spaces.readonly"],
    });
  } else if ("useApplicationDefaultCredentials" in auth) {
    authClient = new googleAuth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/chat.spaces.readonly"],
    });
  } else {
    // Custom auth client (e.g., Vercel OIDC)
    authClient = auth.auth;
  }

  const workspaceEvents = workspaceevents({
    version: "v1",
    auth: authClient,
  });

  const response = await workspaceEvents.subscriptions.list({
    filter: `target_resource="//chat.googleapis.com/${spaceName}"`,
  });

  return (response.data.subscriptions || []).map((sub) => ({
    name: sub.name || "",
    expireTime: sub.expireTime || "",
    eventTypes: sub.eventTypes || [],
  }));
}

/**
 * Delete a Workspace Events subscription.
 */
export async function deleteSpaceSubscription(
  subscriptionName: string,
  auth: WorkspaceEventsAuthOptions
): Promise<void> {
  let authClient: Parameters<typeof workspaceevents>[0]["auth"];

  if ("credentials" in auth) {
    authClient = new googleAuth.JWT({
      email: auth.credentials.client_email,
      key: auth.credentials.private_key,
      subject: auth.impersonateUser,
      scopes: ["https://www.googleapis.com/auth/chat.spaces.readonly"],
    });
  } else if ("useApplicationDefaultCredentials" in auth) {
    authClient = new googleAuth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/chat.spaces.readonly"],
    });
  } else {
    // Custom auth client (e.g., Vercel OIDC)
    authClient = auth.auth;
  }

  const workspaceEvents = workspaceevents({
    version: "v1",
    auth: authClient,
  });

  await workspaceEvents.subscriptions.delete({
    name: subscriptionName,
  });
}

/**
 * Decode a Pub/Sub push message into a Workspace Event notification.
 *
 * The message uses CloudEvents format where event metadata is in attributes
 * (ce-type, ce-source, ce-subject, ce-time) and the payload is base64 encoded.
 *
 * @example
 * ```typescript
 * // In your /api/webhooks/gchat/pubsub route:
 * const body = await request.json();
 * const event = decodePubSubMessage(body);
 *
 * if (event.eventType === "google.workspace.chat.message.v1.created") {
 *   // Handle new message
 *   console.log("New message:", event.message?.text);
 * }
 * ```
 */
export function decodePubSubMessage(
  pushMessage: PubSubPushMessage
): WorkspaceEventNotification {
  // Decode the base64 payload
  const data = Buffer.from(pushMessage.message.data, "base64").toString(
    "utf-8"
  );
  const payload = JSON.parse(data) as {
    message?: GoogleChatMessage;
    reaction?: GoogleChatReaction;
  };

  // Extract CloudEvents metadata from attributes
  const attributes = pushMessage.message.attributes || {};

  return {
    subscription: pushMessage.subscription,
    targetResource: attributes["ce-subject"] || "",
    eventType: attributes["ce-type"] || "",
    eventTime: attributes["ce-time"] || pushMessage.message.publishTime,
    message: payload.message,
    reaction: payload.reaction,
  };
}

/**
 * Verify a Pub/Sub push message is authentic.
 * In production, you should verify the JWT token in the Authorization header.
 *
 * @see https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
 */
export function verifyPubSubRequest(
  request: Request,
  _expectedAudience?: string
): boolean {
  // Basic check - Pub/Sub always sends POST with specific content type
  if (request.method !== "POST") {
    return false;
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return false;
  }

  // For full verification, you would:
  // 1. Extract the Bearer token from Authorization header
  // 2. Verify it's a valid Google-signed JWT
  // 3. Check the audience matches your endpoint
  // This requires additional setup - see Google's docs

  return true;
}
