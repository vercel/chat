import { secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const linq = {
  author: "Linq",
  description:
    "iMessage and SMS adapter for Chat SDK, built and maintained by Linq.",
  env: {
    config: ["baseURL"],
    required: [
      secretEnv("LINQ_API_KEY", "Linq API key for outbound API calls."),
      secretEnv(
        "LINQ_WEBHOOK_SECRET",
        "Webhook signing secret used to verify inbound HMAC-SHA256 signatures."
      ),
    ],
  },
  factoryExport: "createLinqAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "yes", label: "Text, first part" },
    deleteMessage: "no",
    fileUploads: { status: "yes", label: "Images, audio, files" },
    streaming: { status: "partial", label: "Buffered" },
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
    addReactions: { status: "yes", label: "Tapbacks" },
    removeReactions: { status: "yes", label: "Tapbacks" },
    typingIndicator: { status: "partial", label: "DMs only" },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: "no",
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Linq",
  packageName: "@linqapp/chat-sdk-adapter",
  peerDeps: [],
  readme:
    "https://github.com/linq-team/linq-chat-sdk/tree/caa798044551ca9c8e509ca305ed7ec384b32635/packages/adapter-linq",
  slug: "linq",
  type: "platform",
} as const satisfies CatalogAdapter;
