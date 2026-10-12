import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const gchat = {
  beta: true,
  description:
    "Integrate with Google Chat spaces for team collaboration and automated workflows.",
  env: {
    credentialModes: [
      {
        label: "Service account credentials",
        vars: [
          secretEnv(
            "GOOGLE_CHAT_CREDENTIALS",
            "Service account credentials JSON or path."
          ),
        ],
      },
      {
        label: "Application Default Credentials",
        vars: [
          env(
            "GOOGLE_CHAT_USE_ADC",
            "Set to true to use Application Default Credentials."
          ),
        ],
      },
    ],
    optional: [
      env(
        "GOOGLE_CHAT_BOT_USER_ID",
        "Canonical users/... resource name of this Chat app."
      ),
      env("GOOGLE_CHAT_PUBSUB_TOPIC", "Pub/Sub topic for Workspace Events."),
      env(
        "GOOGLE_CHAT_IMPERSONATE_USER",
        "User email for domain-wide delegation."
      ),
      env(
        "GOOGLE_CHAT_PROJECT_NUMBER",
        "Google Cloud project number for signature validation."
      ),
      env(
        "GOOGLE_CHAT_PUBSUB_AUDIENCE",
        "Audience used for Workspace Events push verification."
      ),
      env(
        "GOOGLE_CHAT_PUBSUB_SERVICE_ACCOUNT_EMAIL",
        "Service account your Pub/Sub push subscription authenticates as. Required to accept Pub/Sub pushes."
      ),
      env(
        "GOOGLE_CHAT_WORKSPACE_ADDON_SERVICE_ACCOUNT_EMAIL",
        "Your Workspace Add-on service account identity. Required to accept add-on webhooks."
      ),
      env(
        "GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION",
        "Set to true to disable signature verification for local fixtures."
      ),
      urlEnv("GOOGLE_CHAT_API_URL", "Override the Google Chat API URL."),
    ],
  },
  factoryExport: "createGoogleChatAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "no",
    streaming: { status: "partial", label: "Post+Edit" },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "Google Chat Cards" },
    buttons: "yes",
    linkButtons: "yes",
    selectMenus: "yes",
    tables: { status: "partial", label: "ASCII" },
    fields: "yes",
    imagesInCards: "yes",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: { status: "yes", label: "Workspace Events" },
    removeReactions: { status: "yes", label: "Workspace Events" },
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: { status: "yes", label: "Requires delegation" },
    ephemeralMessages: { status: "yes", label: "Native" },
    userLookup: { status: "partial", label: "Cached" },
    customApiEndpoint: "yes",
    fetchMessages: { status: "yes", label: "Requires delegation" },
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "gchat",
  name: "Google Chat",
  packageName: "@chat-adapter/gchat",
  peerDeps: ["@googleapis/chat", "@googleapis/workspaceevents"],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-gchat",
  slug: "gchat",
  type: "platform",
} as const satisfies CatalogAdapter;
