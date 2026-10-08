import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const agentphone = {
  author: "AgentPhone",
  description:
    "Unified SMS, MMS, iMessage, and voice adapter for Chat SDK with HMAC-verified webhooks, iMessage reactions, and voice call transcripts via AgentPhone.",
  env: {
    config: ["apiUrl", "userName"],
    optional: [
      secretEnv(
        "AGENTPHONE_WEBHOOK_SECRET",
        "Webhook signing secret for HMAC-SHA256 verification."
      ),
    ],
    required: [
      secretEnv("AGENTPHONE_API_KEY", "AgentPhone API key."),
      env("AGENTPHONE_AGENT_ID", "Agent ID used to send messages."),
    ],
  },
  factoryExport: "createAgentPhoneAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: { status: "yes", label: "MMS and iMessage" },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: "no",
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: { status: "yes", label: "iMessage only" },
    removeReactions: "no",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: "no",
    fetchMessages: "no",
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "AgentPhone",
  packageName: "@agentphone/chat-sdk-adapter",
  peerDeps: [],
  readme: "https://github.com/AgentPhone-AI/chat-sdk-adapter",
  slug: "agentphone",
  type: "platform",
} as const satisfies CatalogAdapter;
