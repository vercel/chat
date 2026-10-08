import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const slack = {
  beta: true,
  description:
    "Build bots for Slack workspaces with full support for threads, reactions, and interactive messages.",
  env: {
    credentialModes: [
      {
        label: "Single workspace bot token",
        vars: [
          secretEnv("SLACK_BOT_TOKEN", "Slack bot token."),
          secretEnv(
            "SLACK_SIGNING_SECRET",
            "Slack signing secret for webhook verification."
          ),
        ],
      },
      {
        label: "Multi-workspace OAuth",
        vars: [
          env("SLACK_CLIENT_ID", "Slack app client ID."),
          secretEnv("SLACK_CLIENT_SECRET", "Slack app client secret."),
          secretEnv(
            "SLACK_SIGNING_SECRET",
            "Slack signing secret for webhook verification."
          ),
        ],
      },
    ],
    optional: [
      secretEnv("SLACK_APP_TOKEN", "Slack app-level token for Socket Mode."),
      secretEnv(
        "SLACK_ENCRYPTION_KEY",
        "AES-256-GCM key for encrypting stored OAuth tokens."
      ),
      urlEnv("SLACK_API_URL", "Override the Slack API base URL."),
      secretEnv(
        "SLACK_SOCKET_FORWARDING_SECRET",
        "Secret used to authenticate forwarded Socket Mode events."
      ),
    ],
  },
  factoryExport: "createSlackAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "yes",
    streaming: { status: "yes", label: "Native" },
    scheduledMessages: { status: "yes", label: "Native" },
    cardFormat: { status: "yes", label: "Block Kit" },
    buttons: "yes",
    linkButtons: "yes",
    selectMenus: "yes",
    tables: { status: "yes", label: "Block Kit" },
    charts: { status: "yes", label: "Block Kit" },
    fields: "yes",
    imagesInCards: "yes",
    modals: "yes",
    slashCommands: "yes",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "yes",
    messageUpdatedEvents: "yes",
    messageDeletedEvents: "yes",
    directMessages: "yes",
    ephemeralMessages: { status: "yes", label: "Native" },
    userLookup: "yes",
    customApiEndpoint: "yes",
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "slack",
  name: "Slack",
  packageName: "@chat-adapter/slack",
  peerDeps: ["@slack/socket-mode", "@slack/web-api"],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-slack",
  slug: "slack",
  type: "platform",
} as const satisfies CatalogAdapter;
