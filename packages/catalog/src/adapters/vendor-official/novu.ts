import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const novu = {
  author: "Novu",
  description:
    "Multi-channel agents with one-click channel setup, identity and multi-tenancy",
  env: {
    optional: [
      urlEnv(
        "NOVU_API_BASE_URL",
        "API base URL. Defaults to https://api.novu.co."
      ),
    ],
    required: [
      secretEnv(
        "NOVU_SECRET_KEY",
        "Novu API key that authorizes replies and verifies the inbound HMAC. Set automatically by npx novu connect."
      ),
      env(
        "NOVU_AGENT_IDENTIFIER",
        "Bridge agent ID set automatically by npx novu connect."
      ),
    ],
  },
  factoryExport: "createNovuAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "no",
    fileUploads: { status: "yes", label: "Outbound" },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: "yes",
    buttons: "yes",
    linkButtons: "no",
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "no",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: {
      status: "partial",
      label: "Inbound only (no openDM in v1)",
    },
    ephemeralMessages: "no",
    userLookup: { status: "yes", label: "getUser, getSubscriber" },
    parentSubject: "no",
    nativeClient: { status: "yes", label: "getNovuContext()" },
    customApiEndpoint: { status: "yes", label: "NOVU_API_BASE_URL" },
    fetchMessages: { status: "yes", label: "getHistory" },
    fetchSingleMessage: "no",
    fetchThreadInfo: { status: "yes", label: "getMetadata" },
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Novu",
  packageName: "@novu/chat-sdk-adapter",
  peerDeps: [],
  readme:
    "https://github.com/novuhq/novu/tree/24d8855c294bcf27450c91d2e2a0f9db9ffb8f73/packages/chat-adapter",
  slug: "novu",
  type: "platform",
} as const satisfies CatalogAdapter;
