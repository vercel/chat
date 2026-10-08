import { secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const messenger = {
  beta: true,
  description:
    "Build bots for Facebook Messenger with support for templates, buttons, reactions, and postbacks.",
  env: {
    config: ["apiVersion", "userName"],
    required: [
      secretEnv(
        "FACEBOOK_APP_SECRET",
        "App secret for webhook signature verification."
      ),
      secretEnv(
        "FACEBOOK_PAGE_ACCESS_TOKEN",
        "Page access token for the Send API."
      ),
      secretEnv("FACEBOOK_VERIFY_TOKEN", "Webhook verification token."),
    ],
  },
  factoryExport: "createMessengerAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: "no",
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Generic / Button Templates" },
    buttons: { status: "partial", label: "Max 3, postback" },
    linkButtons: { status: "yes", label: "web_url" },
    selectMenus: "no",
    tables: { status: "partial", label: "ASCII" },
    fields: { status: "partial", label: "ASCII" },
    imagesInCards: "yes",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: "yes",
    markAsRead: "yes",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    customApiEndpoint: "yes",
    fetchMessages: { status: "partial", label: "Cached sent only" },
    fetchSingleMessage: { status: "partial", label: "Cached" },
    fetchThreadInfo: "yes",
    fetchChannelMessages: { status: "partial", label: "Cached" },
    listThreads: "no",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "messenger",
  name: "Messenger",
  packageName: "@chat-adapter/messenger",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-messenger",
  slug: "messenger",
  type: "platform",
} as const satisfies CatalogAdapter;
