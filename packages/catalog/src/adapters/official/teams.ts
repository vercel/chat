import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const teams = {
  beta: true,
  description:
    "Deploy bots to Microsoft Teams with adaptive cards, mentions, and conversation threading.",
  env: {
    credentialModes: [
      {
        label: "Bot Framework client secret",
        vars: [
          env("TEAMS_APP_ID", "Azure Bot App ID."),
          secretEnv("TEAMS_APP_PASSWORD", "Azure Bot App password."),
        ],
      },
    ],
    optional: [
      env("TEAMS_APP_TENANT_ID", "Azure AD tenant ID for single-tenant apps."),
      urlEnv(
        "TEAMS_API_URL",
        "Override the Teams API base URL for sovereign clouds."
      ),
    ],
  },
  factoryExport: "createTeamsAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "yes",
    streaming: { status: "partial", label: "Native (DMs) / Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "Adaptive Cards" },
    buttons: "yes",
    linkButtons: "yes",
    selectMenus: "no",
    tables: { status: "yes", label: "Adaptive Card Table" },
    fields: "yes",
    imagesInCards: "yes",
    modals: "yes",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "yes",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: { status: "yes", label: "Targeted messages" },
    userLookup: { status: "partial", label: "Cached" },
    customApiEndpoint: "yes",
    fetchMessages: { status: "yes", label: "Requires Graph permissions" },
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: {
      status: "yes",
      label: "Requires Graph permissions",
    },
    listThreads: { status: "yes", label: "Requires Graph permissions" },
    fetchChannelInfo: { status: "yes", label: "Requires Graph permissions" },
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "teams",
  name: "Microsoft Teams",
  packageName: "@chat-adapter/teams",
  peerDeps: [
    "@microsoft/teams.api",
    "@microsoft/teams.apps",
    "@microsoft/teams.cards",
    "@microsoft/teams.graph-endpoints",
  ],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-teams",
  slug: "teams",
  type: "platform",
} as const satisfies CatalogAdapter;
