import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const xchat = {
  beta: true,
  description:
    "Hold encrypted 1:1 and group conversations on XChat with all cryptography handled inside the adapter.",
  env: {
    optional: [
      secretEnv(
        "X_CONSUMER_SECRET",
        "App consumer secret for webhook CRC and signature verification. Required to receive webhooks: incoming POSTs are rejected when omitted. Polling deployments do not need it."
      ),
      env(
        "X_DISABLE_WEBHOOK_VERIFICATION",
        "Set to true to accept webhook POSTs without verifying their signature. Not recommended in production."
      ),
      env(
        "X_BOT_USERNAME",
        "Bot account handle used for mention detection. Resolved from /2/users/me when omitted."
      ),
      env(
        "X_VERIFY_SIGNATURES",
        "Set to false to accept messages without verifiable signatures. Defaults to true."
      ),
      env(
        "X_SIGNING_KEY_VERSION",
        "Signing key version override. Fetched from the X API when omitted."
      ),
    ],
    required: [
      secretEnv(
        "XCHAT_BOT_TOKEN",
        "OAuth 2.0 user access token for the bot account.",
        { aliases: ["X_ACCESS_TOKEN"] }
      ),
      secretEnv(
        "XCHAT_PIN",
        "Juicebox PIN used to unlock the bot's private keys at startup."
      ),
    ],
  },
  factoryExport: "createXchatAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial", label: "Own text messages, age-gated" },
    deleteMessage: { status: "partial", label: "Own messages" },
    fileUploads: "yes",
    streaming: { status: "partial", label: "Age-gated edits" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Plain text + URL preview" },
    buttons: "no",
    linkButtons: { status: "partial", label: "Tappable URLs" },
    selectMenus: "no",
    tables: { status: "partial", label: "ASCII" },
    fields: { status: "partial", label: "Plain text" },
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "yes",
    markAsRead: "yes",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    customApiEndpoint: { status: "partial", label: "Media REST calls" },
    fetchMessages: "yes",
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "official",
  icon: "xchat",
  importPath: "@chat-adapter/x/chat",
  name: "XChat",
  packageName: "@chat-adapter/x",
  peerDeps: ["@xdevplatform/chat-xdk", "@xdevplatform/xdk", "juicebox-sdk"],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-x",
  slug: "xchat",
  type: "platform",
} as const satisfies CatalogAdapter;
