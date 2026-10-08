import { secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const liveblocks = {
  author: "Liveblocks",
  description:
    "Liveblocks Comments adapter for building conversational bots on top of Liveblocks rooms, threads, and comments.",
  env: {
    config: ["botUserId", "botUserName", "resolveUsers", "resolveGroupsInfo"],
    required: [
      secretEnv("LIVEBLOCKS_SECRET_KEY", "Liveblocks secret key."),
      secretEnv(
        "LIVEBLOCKS_WEBHOOK_SECRET",
        "Liveblocks webhook signing secret."
      ),
    ],
  },
  factoryExport: "createLiveblocksAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: { status: "yes", label: "Attachments" },
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Flattened to text" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "partial", label: "Flattened to text" },
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: { status: "yes", label: "Users + groups" },
    addReactions: { status: "yes", label: "Unicode emoji" },
    removeReactions: { status: "yes", label: "Unicode emoji" },
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "no",
    ephemeralMessages: "no",
    userLookup: { status: "yes", label: "resolveUsers" },
    customApiEndpoint: "no",
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "vendor-official",
  name: "Liveblocks",
  packageName: "@liveblocks/chat-sdk-adapter",
  peerDeps: [],
  readme:
    "https://github.com/liveblocks/liveblocks/tree/a939486c73819ea78a96443d54cb5557881d80b6/packages/liveblocks-chat-sdk-adapter",
  slug: "liveblocks",
  type: "platform",
} as const satisfies CatalogAdapter;
