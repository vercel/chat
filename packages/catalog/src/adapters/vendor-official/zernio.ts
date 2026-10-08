import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const zernio = {
  author: "Zernio",
  description:
    "Unified social media DM adapter covering Instagram, Facebook, Telegram, WhatsApp, X/Twitter, Bluesky, and Reddit through a single integration.",
  env: {
    optional: [
      secretEnv(
        "ZERNIO_WEBHOOK_SECRET",
        "HMAC-SHA256 secret for verifying inbound webhooks."
      ),
      urlEnv("ZERNIO_API_BASE_URL", "Override the Zernio API base URL."),
      env("ZERNIO_BOT_NAME", "Bot display name."),
    ],
    required: [secretEnv("ZERNIO_API_KEY", "Zernio API key.")],
  },
  factoryExport: "createZernioAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial", label: "Telegram" },
    deleteMessage: { status: "partial", label: "Telegram, X" },
    fileUploads: { status: "partial", label: "Not Bluesky or Reddit" },
    streaming: { status: "partial", label: "post+edit (Telegram)" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "FB, IG, Telegram, WhatsApp" },
    buttons: { status: "partial", label: "FB, IG, Telegram, WhatsApp" },
    linkButtons: { status: "partial", label: "FB, IG, Telegram, WhatsApp" },
    selectMenus: { status: "partial", label: "WhatsApp (interactive list)" },
    tables: "no",
    fields: "no",
    imagesInCards: { status: "partial", label: "FB, IG, Telegram, WhatsApp" },
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: { status: "partial", label: "FB, IG, Telegram, WhatsApp" },
    removeReactions: { status: "partial", label: "FB, IG, Telegram, WhatsApp" },
    typingIndicator: { status: "partial", label: "FB, IG, Telegram, WhatsApp" },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "yes",
    customApiEndpoint: { status: "yes", label: "baseUrl" },
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "vendor-official",
  name: "Zernio",
  packageName: "@zernio/chat-sdk-adapter",
  peerDeps: [],
  readme:
    "https://github.com/zernio-dev/chat-sdk-adapter/tree/0a51a1d224536ae5d117a3afb6ab992fab167214",
  slug: "zernio",
  type: "platform",
} as const satisfies CatalogAdapter;
