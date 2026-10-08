import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const twitch = {
  beta: true,
  description:
    "Read and reply in Twitch channel chat with EventSub webhooks and the Helix Chat API, plus whispers.",
  env: {
    credentialModes: [
      {
        label: "Bot username",
        vars: [
          env(
            "TWITCH_BOT_USERNAME",
            "Bot account login, used for mention detection. The user ID is looked up with Get Users."
          ),
        ],
      },
      {
        label: "Bot user ID",
        vars: [
          env(
            "TWITCH_BOT_USER_ID",
            "Bot account user ID, used as the sender of chat messages and whispers and for self-detection. The login is looked up with Get Users."
          ),
        ],
      },
    ],
    notes:
      "Set TWITCH_BOT_USERNAME, TWITCH_BOT_USER_ID, or both. Setting both skips the Get Users lookup during initialization.",
    optional: [
      secretEnv(
        "TWITCH_USER_ACCESS_TOKEN",
        "Bot user access token with user:manage:whispers, used only to send whispers."
      ),
      secretEnv(
        "TWITCH_REFRESH_TOKEN",
        "Bot refresh token for managed whisper token refresh."
      ),
      secretEnv(
        "TWITCH_ENCRYPTION_KEY",
        "AES-256-GCM key for encrypting the tokens stored in the state adapter."
      ),
      urlEnv("TWITCH_API_BASE_URL", "Override the Helix API base URL."),
      urlEnv("TWITCH_AUTH_BASE_URL", "Override the Twitch OAuth base URL."),
    ],
    required: [
      env("TWITCH_CLIENT_ID", "Twitch application client ID."),
      secretEnv(
        "TWITCH_CLIENT_SECRET",
        "Twitch application client secret for app access tokens."
      ),
      secretEnv(
        "TWITCH_WEBHOOK_SECRET",
        "EventSub webhook secret (10 to 100 characters) for signature verification."
      ),
    ],
  },
  factoryExport: "createTwitchAdapter",
  features: {
    postMessage: "yes",
    messageReplies: "yes",
    editMessage: "no",
    deleteMessage: { status: "partial", label: "Chat, as a moderator" },
    fileUploads: "no",
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Plain text" },
    buttons: "no",
    linkButtons: { status: "partial", label: "Rendered as text" },
    selectMenus: "no",
    tables: { status: "partial", label: "One line of text" },
    fields: { status: "partial", label: "Plain text" },
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: { status: "partial", label: "Whispers" },
    ephemeralMessages: "no",
    userLookup: "yes",
    customApiEndpoint: "yes",
    fetchMessages: { status: "partial", label: "Persisted history" },
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "twitch",
  name: "Twitch",
  packageName: "@chat-adapter/twitch",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-twitch",
  slug: "twitch",
  type: "platform",
} as const satisfies CatalogAdapter;
