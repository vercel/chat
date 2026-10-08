import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const sendblue = {
  author: "Sendblue",
  description:
    "iMessage, SMS, and RCS adapter for Chat SDK, built and maintained by Sendblue.",
  env: {
    config: ["webhookSecretHeader", "allowedServices"],
    optional: [
      secretEnv(
        "SENDBLUE_WEBHOOK_SECRET",
        "Shared secret for webhook verification."
      ),
      urlEnv(
        "SENDBLUE_STATUS_CALLBACK_URL",
        "Status callback URL for outbound delivery events."
      ),
    ],
    required: [
      secretEnv("SENDBLUE_API_KEY", "Sendblue API key ID."),
      secretEnv("SENDBLUE_API_SECRET", "Sendblue API secret key."),
      env("SENDBLUE_FROM_NUMBER", "Sendblue sender number in E.164 format."),
    ],
  },
  factoryExport: "createSendblueAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: { status: "partial", label: "Inbound + via SDK" },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: "no",
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: { status: "yes", label: "Tapbacks" },
    removeReactions: "no",
    typingIndicator: { status: "partial", label: "1:1 only" },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: { status: "yes", label: "evaluateService" },
    customApiEndpoint: "no",
    fetchMessages: "yes",
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "no",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "vendor-official",
  name: "Sendblue",
  packageName: "chat-adapter-sendblue",
  peerDeps: [],
  readme: "https://github.com/sendblue-api/chat-adapter-sendblue",
  slug: "sendblue",
  type: "platform",
} as const satisfies CatalogAdapter;
