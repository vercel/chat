import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const twilio = {
  beta: true,
  description:
    "Build SMS, MMS, and RCS bots with Twilio Messaging webhooks and the Messages API.",
  env: {
    config: [
      "webhookUrl",
      "webhookVerifier",
      "statusCallbackUrl",
      "apiUrl",
      "contentApiUrl",
    ],
    credentialModes: [
      {
        label: "Account credentials",
        vars: [
          env("TWILIO_ACCOUNT_SID", "Twilio Account SID."),
          secretEnv("TWILIO_AUTH_TOKEN", "Twilio Auth Token."),
        ],
      },
    ],
    optional: [
      env("TWILIO_PHONE_NUMBER", "Default sender phone number for openDM."),
      env(
        "TWILIO_MESSAGING_SERVICE_SID",
        "Default Messaging Service SID for openDM."
      ),
      env(
        "TWILIO_RCS_SENDER_ID",
        "Direct RCS sender address for openDM when targeting RCS."
      ),
    ],
  },
  factoryExport: "createTwilioAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "yes",
    fileUploads: { status: "partial", label: "Public media URLs" },
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: {
      status: "partial",
      label: "RCS rich cards + SMS text fallback",
    },
    buttons: { status: "partial", label: "RCS quick-replies" },
    linkButtons: { status: "partial", label: "RCS call-to-action" },
    selectMenus: "no",
    tables: { status: "partial", label: "ASCII" },
    fields: "yes",
    imagesInCards: { status: "partial", label: "RCS only" },
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    customApiEndpoint: "yes",
    fetchMessages: { status: "partial", label: "Messages API" },
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "official",
  icon: "twilio",
  name: "Twilio",
  packageName: "@chat-adapter/twilio",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-twilio",
  slug: "twilio",
  type: "platform",
} as const satisfies CatalogAdapter;
