import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const hibira = {
  author: "Hibira",
  description:
    "Hibira Live Chat conversations from the website widget, LINE and email as direct messages, with verified webhooks and handoff to the human team.",
  env: {
    config: [
      "userName",
      "dispatchAgentMessages",
      "onEvent",
      "signatureToleranceSeconds",
      "fetch",
      "logger",
    ],
    notes:
      "apiKey and webhookSecret also accept a function instead of a string. The adapter calls it on every API request and webhook and never caches the result.",
    optional: [
      env(
        "HIBIRA_LIVECHAT_AGENT_ID",
        "Live Chat agent the bot replies as. Defaults to the agent who created the API key."
      ),
      urlEnv(
        "HIBIRA_LIVECHAT_API_URL",
        "REST API base URL. Defaults to https://chat.hibira.io/v1."
      ),
    ],
    required: [
      secretEnv(
        "HIBIRA_LIVECHAT_API_KEY",
        "Workspace API key with the write scope (lck_…), from Settings › API & webhooks."
      ),
      secretEnv(
        "HIBIRA_LIVECHAT_WEBHOOK_SECRET",
        "Signing secret of the webhook endpoint that delivers to the bot (lcwh_…)."
      ),
    ],
  },
  factoryExport: "createHibiraAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: "no",
    streaming: { status: "partial", label: "Buffered, with typing" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Plain-text fallback" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "partial", label: "Plain-text fallback" },
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: {
      status: "partial",
      label: "After the bot's first reply",
    },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: { status: "yes", label: "apiUrl" },
    fetchMessages: { status: "yes", label: "Latest 100" },
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Hibira Live Chat",
  packageName: "@hibira-io/chat-adapter",
  peerDeps: [],
  readme: "https://github.com/hibira-io/chat-adapter/tree/v0.1.1",
  slug: "hibira",
  type: "platform",
} as const satisfies CatalogAdapter;
