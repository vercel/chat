import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const x = {
  beta: true,
  description:
    "Reply to public mentions and hold direct message conversations on X (Twitter) with the X API v2.",
  env: {
    credentialModes: [
      {
        label: "Static access token",
        vars: [
          secretEnv(
            "X_USER_ACCESS_TOKEN",
            "OAuth 2.0 user-context access token for outbound API calls."
          ),
        ],
      },
      {
        label: "Managed OAuth refresh",
        vars: [
          env("X_CLIENT_ID", "OAuth 2.0 client ID."),
          secretEnv(
            "X_REFRESH_TOKEN",
            "OAuth 2.0 refresh token (requires the offline.access scope)."
          ),
        ],
      },
    ],
    optional: [
      secretEnv(
        "X_CLIENT_SECRET",
        "OAuth 2.0 client secret for confidential clients."
      ),
      secretEnv(
        "X_ENCRYPTION_KEY",
        "AES-256-GCM key for encrypting stored OAuth tokens."
      ),
      env(
        "X_USER_ID",
        "Bot account user ID. Fetched from /2/users/me when omitted."
      ),
      env(
        "X_USERNAME",
        "Bot account handle used for mention detection. Fetched when omitted."
      ),
      urlEnv("X_API_BASE_URL", "Override the X API base URL."),
    ],
    required: [
      secretEnv(
        "X_CONSUMER_SECRET",
        "App API key secret used for webhook CRC and signature verification."
      ),
    ],
  },
  factoryExport: "createXAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial", label: "Posts only" },
    deleteMessage: "yes",
    fileUploads: "yes",
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Plain text" },
    buttons: "no",
    linkButtons: { status: "partial", label: "Rendered as text" },
    selectMenus: "no",
    tables: { status: "partial", label: "ASCII" },
    fields: { status: "partial", label: "Plain text" },
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: { status: "partial", label: "Likes only" },
    removeReactions: { status: "partial", label: "Likes only" },
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    customApiEndpoint: "yes",
    fetchMessages: { status: "partial", label: "DMs via API, posts cached" },
    fetchSingleMessage: {
      status: "partial",
      label: "Posts via API, DMs cached",
    },
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "x",
  name: "X",
  packageName: "@chat-adapter/x",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-x",
  slug: "x",
  type: "platform",
} as const satisfies CatalogAdapter;
