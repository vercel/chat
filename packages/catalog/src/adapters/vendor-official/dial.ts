import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const dial = {
  author: "Dial",
  description:
    "SMS, MMS, iMessage, and inbound voice-call transcripts for Chat SDK, built and maintained by Dial. One handler answers phone traffic the same way it answers Slack/Teams/Discord, with HMAC-signed webhooks and replies over @getdial/sdk.",
  env: {
    config: ["apiBaseUrl", "botName", "logger"],
    optional: [
      secretEnv(
        "DIAL_WEBHOOK_SECRET",
        "HMAC-SHA256 signing secret from the Dial webhook subscription; enables signature verification of inbound requests."
      ),
      env(
        "DIAL_API_URL",
        "Override the Dial API host. Defaults to https://api.getdial.ai."
      ),
      env(
        "BOT_USERNAME",
        'Display name Chat SDK uses for the bot. Defaults to "bot".'
      ),
    ],
    required: [
      secretEnv("DIAL_API_KEY", "Dial API key (sk_live_…)."),
      env(
        "DIAL_FROM_NUMBER_ID",
        "Dial's ID of the phone number the bot sends from."
      ),
    ],
  },
  factoryExport: "createDialAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: { status: "yes", label: "MMS & iMessage media" },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: "no",
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "partial", label: "Flattened to ASCII code blocks" },
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: { status: "partial", label: "DMs only; every phone pair is 1:1" },
    addReactions: {
      status: "yes",
      label:
        "Native Tapbacks on iMessage, both directions; emoji delivered as text on SMS",
    },
    removeReactions: "no",
    typingIndicator: {
      status: "partial",
      label: "iMessage numbers only; silently ignored on SMS",
    },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: { status: "yes", label: "apiBaseUrl override" },
    fetchMessages: {
      status: "partial",
      label:
        "Backfills from the account's 100 most recent messages; no pagination",
    },
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "yes",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Dial",
  packageName: "@getdial/chat-sdk-adapter",
  peerDeps: [],
  readme: "https://github.com/GetDial-AI/chat-sdk-adapter",
  slug: "dial",
  type: "platform",
} as const satisfies CatalogAdapter;
