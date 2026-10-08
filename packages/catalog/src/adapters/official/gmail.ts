import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const gmail = {
  beta: true,
  description:
    "Receive labelled emails and send threaded replies, or use standalone Gmail APIs without the Chat runtime.",
  env: {
    config: ["fetch", "logger", "webhookVerifier"],
    credentialModes: [
      {
        label: "OAuth refresh credentials",
        vars: [
          env("GMAIL_CLIENT_ID", "Google OAuth client ID."),
          secretEnv("GMAIL_CLIENT_SECRET", "Google OAuth client secret."),
          secretEnv("GMAIL_REFRESH_TOKEN", "Mailbox user's refresh token."),
        ],
      },
      {
        label: "Access token",
        vars: [secretEnv("GMAIL_ACCESS_TOKEN", "Mailbox user's access token.")],
      },
    ],
    required: [
      env("GMAIL_MAILBOX", "Mailbox email address, not me."),
      env("GMAIL_LABEL_ID", "Intake label ID, not its display name."),
      env("GMAIL_SUBSCRIPTION", "Expected full Pub/Sub subscription name."),
      urlEnv("GMAIL_PUBSUB_AUDIENCE", "Expected push JWT audience."),
      env(
        "GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL",
        "Push authentication service account email."
      ),
    ],
    optional: [
      env(
        "GMAIL_TOPIC_NAME",
        "Full Pub/Sub topic name for watch registration."
      ),
      env(
        "GMAIL_REPLY_ALL",
        "Set to true to include original To and Cc recipients."
      ),
    ],
    notes:
      "A custom webhookVerifier replaces Pub/Sub JWT verification; audience and service account email are then optional. Deploy the webhook before calling watch(), renew daily and schedule periodic sync() with shared persistent state. The intake label is not an OAuth access boundary.",
  },
  factoryExport: "createGmailAdapter",
  features: {
    postMessage: "yes",
    messageReplies: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: "yes",
    streaming: { status: "partial", label: "Buffered email" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Plain text" },
    buttons: "no",
    linkButtons: { status: "partial", label: "Text links" },
    selectMenus: "no",
    tables: { status: "partial", label: "Plain text" },
    fields: { status: "partial", label: "Plain text" },
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: { status: "partial", label: "Label-based intake" },
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: { status: "partial", label: "Email to recipient" },
    ephemeralMessages: { status: "partial", label: "Permanent private email" },
    userLookup: "no",
    customApiEndpoint: "no",
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "official",
  icon: "gmail",
  name: "Gmail",
  packageName: "@chat-adapter/gmail",
  peerDeps: ["html-to-text", "jose", "mimetext", "postal-mime", "zod"],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-gmail",
  slug: "gmail",
  type: "platform",
} as const satisfies CatalogAdapter;
