import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const photon = {
  author: "Photon",
  description:
    "iMessage adapter for Chat SDK, built and maintained by Photon. Cloud, self-hosted, and on-device (macOS) iMessage over spectrum-ts.",
  env: {
    config: ["clients", "logger"],
    credentialModes: [
      {
        label: "Spectrum Cloud",
        vars: [
          env("IMESSAGE_PROJECT_ID", "Spectrum Cloud project ID."),
          secretEnv(
            "IMESSAGE_PROJECT_SECRET",
            "Spectrum Cloud project secret."
          ),
        ],
      },
      {
        label: "Self-hosted",
        vars: [
          urlEnv(
            "IMESSAGE_SERVER_URL",
            "gRPC host:port of a self-hosted iMessage server (not an https URL)."
          ),
          secretEnv(
            "IMESSAGE_API_KEY",
            "Auth token for the self-hosted server."
          ),
        ],
      },
    ],
    optional: [
      env(
        "IMESSAGE_LOCAL",
        'Set to "false" for cloud/self-host; on-device (local, macOS) mode is the default.'
      ),
      secretEnv(
        "IMESSAGE_WEBHOOK_SECRET",
        "Per-webhook signing secret for verifying Spectrum Cloud deliveries."
      ),
      env("IMESSAGE_PHONE", "Routing/identity phone for multi-number setups."),
    ],
  },
  factoryExport: "createiMessageAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial", label: "Remote only" },
    deleteMessage: "no",
    fileUploads: { status: "yes", label: "Send" },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: "no",
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: "no",
    modals: { status: "partial", label: "Remote only, native polls" },
    slashCommands: "no",
    mentions: { status: "partial", label: "DMs only" },
    addReactions: { status: "partial", label: "Tapbacks, remote only" },
    removeReactions: "no",
    typingIndicator: { status: "partial", label: "Remote only" },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: "no",
    fetchMessages: "no",
    fetchSingleMessage: "no",
    fetchThreadInfo: "no",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Photon",
  packageName: "@photon-ai/chat-adapter-imessage",
  peerDeps: [],
  readme: "https://github.com/photon-hq/vercel-chat-adapter-imessage",
  slug: "photon",
  type: "platform",
} as const satisfies CatalogAdapter;
