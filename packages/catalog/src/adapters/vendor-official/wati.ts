import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const wati = {
  author: "Wati",
  description:
    "WhatsApp adapter for Chat SDK built on the Wati API, with reply buttons, list menus, media, templates, typing indicators, and conversation history.",
  env: {
    config: [
      "verifyWebhooks",
      "actionMappingTtlMs",
      "logger",
      "logLevel",
      "fetch",
    ],
    optional: [
      env(
        "WATI_CHANNEL_PHONE_NUMBER",
        "WhatsApp Business number to send from when the workspace has several."
      ),
      env("WATI_BOT_USERNAME", "Bot display name."),
    ],
    required: [
      urlEnv(
        "WATI_API_ENDPOINT",
        "Wati REST API host for the workspace, for example https://live-mt-server.wati.io."
      ),
      secretEnv("WATI_ACCESS_TOKEN", "Wati API access token."),
      secretEnv(
        "WATI_WEBHOOK_SECRET",
        "Secret that Wati webhook deliveries must carry in the token query parameter or x-wati-webhook-secret header."
      ),
    ],
  },
  factoryExport: "createWatiAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: {
      status: "yes",
      label: "Images, video, audio, documents",
    },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: {
      status: "partial",
      label: "WhatsApp interactive messages",
    },
    buttons: { status: "yes", label: "Up to 3 reply buttons, 4-10 as a list" },
    linkButtons: { status: "partial", label: "Sent as text" },
    selectMenus: { status: "yes", label: "List messages, up to 10 options" },
    tables: { status: "partial", label: "Monospace text" },
    fields: { status: "partial", label: "Sent as text" },
    imagesInCards: { status: "partial", label: "Image header" },
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: { status: "yes", label: "Turn on in Wati settings" },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: { status: "yes", label: "Regional hosts" },
    fetchMessages: { status: "partial", label: "Newest first only" },
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Wati",
  packageName: "@wati-io/chat-sdk-adapter",
  peerDeps: [],
  readme: "https://github.com/wati-io/chat-sdk-adapter/tree/v0.1.2/adapter",
  slug: "wati",
  type: "platform",
} as const satisfies CatalogAdapter;
