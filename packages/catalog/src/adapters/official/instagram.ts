import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const instagram = {
  beta: true,
  description:
    "Build bots for Instagram Direct with DMs, media, quick replies, reactions, and story replies.",
  env: {
    config: ["apiVersion", "userName"],
    optional: [
      env(
        "INSTAGRAM_API_VERSION",
        "Meta Graph API version. Defaults to the adapter's supported version."
      ),
    ],
    required: [
      secretEnv(
        "INSTAGRAM_ACCESS_TOKEN",
        "Instagram access token for the Messaging API."
      ),
      secretEnv(
        "INSTAGRAM_APP_SECRET",
        "Meta app secret for webhook signature verification."
      ),
      secretEnv("INSTAGRAM_VERIFY_TOKEN", "Webhook verification token."),
      env(
        "INSTAGRAM_ACCOUNT_ID",
        "Instagram professional account ID used to send messages."
      ),
    ],
  },
  factoryExport: "createInstagramAdapter",
  features: {
    postMessage: "yes",
    editMessage: "no",
    deleteMessage: "no",
    fileUploads: { status: "yes", label: "Uploads and HTTPS URLs" },
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Generic / Button Templates" },
    buttons: { status: "partial", label: "Quick replies / postbacks" },
    linkButtons: { status: "yes", label: "web_url" },
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: "yes",
    modals: "no",
    slashCommands: "no",
    mentions: "no",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: "yes",
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
  icon: "instagram",
  name: "Instagram",
  packageName: "@chat-adapter/instagram",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-instagram",
  slug: "instagram",
  type: "platform",
} as const satisfies CatalogAdapter;
