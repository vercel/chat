import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const photon = {
  author: "Photon",
  description:
    "Photon adapter for Chat SDK, built and maintained by Photon. Connects a bot to the iMessage, SMS, WhatsApp, WhatsApp Business, Telegram, and email channels of a Photon Beta project over signed webhooks or a WebSocket gateway.",
  env: {
    config: ["userName", "logger"],
    required: [
      env("PHOTON_PROJECT_ID", "Photon Beta project ID."),
      secretEnv("PHOTON_API_KEY", "Photon project API key."),
    ],
    optional: [
      secretEnv(
        "PHOTON_WEBHOOK_SECRET",
        "Signing secret of the webhook destination. Required to receive messages by webhook."
      ),
      env(
        "PHOTON_AGENT_USER_ID",
        "Agent User that openDM starts conversations from. Required for openDM."
      ),
      urlEnv(
        "PHOTON_API_URL",
        "Photon API origin, without /v1. Defaults to https://api.photon.codes."
      ),
    ],
  },
  factoryExport: "createPhotonAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial", label: "Platform-dependent" },
    deleteMessage: { status: "partial", label: "Platform-dependent" },
    fileUploads: "yes",
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Plain text" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: { status: "partial", label: "Platform-dependent" },
    removeReactions: "no",
    typingIndicator: { status: "partial", label: "Platform-dependent" },
    markAsRead: "yes",
    messageUpdatedEvents: "yes",
    messageDeletedEvents: "yes",
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
  name: "Photon",
  packageName: "@photon-ai/chat-adapter",
  peerDeps: [],
  readme:
    "https://github.com/photon-hq/chat-adapter/tree/6ce80ad32af764f49e97eecf25beef5c65c8177e",
  slug: "photon",
  type: "platform",
} as const satisfies CatalogAdapter;
