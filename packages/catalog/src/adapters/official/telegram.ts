import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const telegram = {
  beta: true,
  description:
    "Connect to Telegram with support for groups, channels, and inline keyboards.",
  env: {
    config: ["nativeStreaming", "streamingEditIntervalMs"],
    optional: [
      env(
        "TELEGRAM_ALLOWED_USER_IDS",
        "Comma-separated Telegram user IDs allowed to trigger the adapter."
      ),
      secretEnv(
        "TELEGRAM_WEBHOOK_SECRET_TOKEN",
        "Webhook secret token required in webhook mode."
      ),
      env(
        "TELEGRAM_ALLOW_UNVERIFIED_WEBHOOKS",
        "Set to true to accept unverified webhooks for local fixtures."
      ),
      env("TELEGRAM_BOT_USERNAME", "Bot username for mention detection."),
      env(
        "TELEGRAM_MENTION_ON_REPLY",
        'Set to "true" to treat a reply to the bot as a mention.'
      ),
      urlEnv("TELEGRAM_API_BASE_URL", "Override the Telegram API base URL."),
    ],
    required: [secretEnv("TELEGRAM_BOT_TOKEN", "Telegram bot token.")],
  },
  factoryExport: "createTelegramAdapter",
  features: {
    postMessage: "yes",
    messageReplies: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "yes",
    streaming: { status: "partial", label: "Post+Edit / Opt-in rich drafts" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "MarkdownV2 + inline keyboard" },
    buttons: { status: "partial", label: "Inline keyboard" },
    linkButtons: { status: "partial", label: "Inline keyboard URLs" },
    selectMenus: "no",
    tables: { status: "partial", label: "Native messages / ASCII cards" },
    fields: "yes",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "yes",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "yes",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: { status: "partial", label: "Seen users" },
    customApiEndpoint: "yes",
    fetchMessages: { status: "partial", label: "Cached" },
    fetchSingleMessage: { status: "partial", label: "Cached" },
    fetchThreadInfo: "yes",
    fetchChannelMessages: { status: "partial", label: "Cached" },
    listThreads: "no",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "telegram",
  name: "Telegram",
  packageName: "@chat-adapter/telegram",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-telegram",
  slug: "telegram",
  type: "platform",
} as const satisfies CatalogAdapter;
