import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const linear = {
  beta: true,
  description:
    "Automate Linear issue comment threads with bot responses and workflows.",
  env: {
    credentialModes: [
      {
        label: "Personal API key",
        vars: [secretEnv("LINEAR_API_KEY", "Personal API key.")],
      },
      {
        label: "Access token",
        vars: [
          secretEnv("LINEAR_ACCESS_TOKEN", "Pre-obtained OAuth access token."),
        ],
      },
      {
        label: "Client credentials",
        vars: [
          env(
            "LINEAR_CLIENT_CREDENTIALS_CLIENT_ID",
            "Client credentials OAuth client ID."
          ),
          secretEnv(
            "LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET",
            "Client credentials OAuth client secret."
          ),
        ],
      },
      {
        label: "OAuth app",
        vars: [
          env("LINEAR_CLIENT_ID", "OAuth client ID."),
          secretEnv("LINEAR_CLIENT_SECRET", "OAuth client secret."),
        ],
      },
    ],
    optional: [
      env(
        "LINEAR_CLIENT_CREDENTIALS_SCOPES",
        "Space-delimited scopes for client-credentials auth."
      ),
      secretEnv(
        "LINEAR_ENCRYPTION_KEY",
        "AES-256-GCM key for encrypting stored OAuth tokens."
      ),
      env("LINEAR_BOT_USERNAME", "Bot display name."),
      urlEnv("LINEAR_API_URL", "Override the Linear API URL."),
    ],
    required: [secretEnv("LINEAR_WEBHOOK_SECRET", "Webhook signing secret.")],
  },
  factoryExport: "createLinearAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial" },
    deleteMessage: { status: "partial" },
    fileUploads: "no",
    streaming: { status: "partial", label: "Agent sessions / Post+Edit" },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "Markdown" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "yes", label: "GFM" },
    fields: "yes",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: { status: "partial" },
    typingIndicator: { status: "partial", label: "Agent sessions" },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "no",
    ephemeralMessages: "no",
    userLookup: "yes",
    parentSubject: "yes",
    nativeClient: "yes",
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
  icon: "linear",
  name: "Linear",
  packageName: "@chat-adapter/linear",
  peerDeps: ["@linear/sdk"],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-linear",
  slug: "linear",
  type: "platform",
} as const satisfies CatalogAdapter;
