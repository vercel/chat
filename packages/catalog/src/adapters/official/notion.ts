import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const notion = {
  beta: true,
  description:
    "Participate in Notion page and block comment discussions via webhooks and the Comments API.",
  env: {
    config: [
      "apiBaseUrl",
      "streamingEditIntervalMs",
      "externalUrlPollDelaysMs",
    ],
    optional: [
      env("NOTION_BOT_USERNAME", "Bot display name for mention detection."),
      env(
        "NOTION_MENTION_MODE",
        'Mention detection mode: "mention" | "all-comments" | "keyword" (default "mention" = plain-text @userName/@botUserId).'
      ),
      env(
        "NOTION_KEYWORDS",
        "Comma-separated keywords when NOTION_MENTION_MODE=keyword."
      ),
      env(
        "NOTION_VERSION",
        "Override Notion-Version header (default 2026-03-11)."
      ),
    ],
    required: [
      secretEnv("NOTION_TOKEN", "Connection access token (Bearer token)."),
      secretEnv(
        "NOTION_VERIFICATION_TOKEN",
        "Webhook HMAC key from the subscription verification handshake."
      ),
    ],
  },
  factoryExport: "createNotionAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: { status: "partial", label: "Up to 3 native attachments" },
    streaming: { status: "partial", label: "Post+Edit" },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "Markdown fallback" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "partial", label: "Flattened markdown" },
    fields: "yes",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "no",
    ephemeralMessages: "no",
    userLookup: "no",
    parentSubject: "yes",
    nativeClient: "no",
    customApiEndpoint: "yes",
    fetchMessages: "yes",
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "official",
  icon: "notion",
  name: "Notion",
  packageName: "@chat-adapter/notion",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-notion",
  slug: "notion",
  type: "platform",
} as const satisfies CatalogAdapter;
