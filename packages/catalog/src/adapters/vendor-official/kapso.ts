import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const kapso = {
  author: "Kapso",
  description:
    "Kapso-first WhatsApp adapter for Chat SDK with signed Kapso webhooks, WhatsApp replies, buttons, media, reactions, and conversation history.",
  env: {
    config: [
      "client",
      "verifyWebhookSignatures",
      "appSecret",
      "webhookVerifyToken",
      "historyFields",
      "cacheSize",
      "logger",
      "debug",
    ],
    optional: [
      env(
        "KAPSO_PHONE_NUMBER_ID",
        "WhatsApp phone number ID connected in Kapso."
      ),
      secretEnv(
        "KAPSO_WEBHOOK_SECRET",
        "Secret used to verify Kapso webhook deliveries."
      ),
      urlEnv("KAPSO_BASE_URL", "Kapso proxy URL."),
      env("KAPSO_BOT_USERNAME", "Bot display name."),
    ],
    required: [
      secretEnv(
        "KAPSO_API_KEY",
        "Kapso API key used for sends, history, contacts, conversations, and media."
      ),
    ],
  },
  factoryExport: "createKapsoAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: {
      status: "yes",
      label: "Images, video, audio, documents, stickers",
    },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: {
      status: "partial",
      label: "WhatsApp-compatible text and actions",
    },
    buttons: { status: "yes", label: "Up to 3 reply buttons" },
    linkButtons: "yes",
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: { status: "partial", label: "Sent as media" },
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: "yes",
    fetchMessages: "yes",
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Kapso",
  packageName: "@kapso/chat-adapter",
  peerDeps: [],
  readme:
    "https://github.com/gokapso/chat-sdk-adapter/tree/7c7e9b349323b8cfa060cc64b15d97bcb9f906b3",
  slug: "kapso",
  type: "platform",
} as const satisfies CatalogAdapter;
