import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const velt = {
  author: "Velt",
  description:
    "Velt Comments adapter for bots that read, reply, mention, and start threads in anchored comments across documents, rich-text editors, canvases, PDFs, and video. Includes per-comment document context and an AI streaming-reply sample app.",
  env: {
    config: [
      "botUserId",
      "botUserName",
      "webhookVersion",
      "resolveUsers",
      "selfHostingConfig",
    ],
    optional: [
      secretEnv(
        "VELT_AUTH_TOKEN",
        "Velt auth token used instead of generated bot-user tokens."
      ),
      env(
        "VELT_ORGANIZATION_ID",
        "Default organization ID for generated tokens and webhook fallback."
      ),
    ],
    required: [
      secretEnv("VELT_API_KEY", "Velt API key for REST API calls."),
      secretEnv("VELT_WEBHOOK_SECRET", "Velt webhook signing secret."),
    ],
  },
  factoryExport: "createVeltAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: { status: "partial", label: "By reference" },
    cardFormat: { status: "partial", label: "Flattened to text" },
    tables: { status: "partial", label: "Flattened to text" },
    mentions: { status: "yes", label: "Users" },
    addReactions: { status: "partial", label: "Bot writes: self-hosted" },
    removeReactions: { status: "partial", label: "Bot writes: self-hosted" },
    userLookup: { status: "yes", label: "resolveUsers" },
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "vendor-official",
  name: "Velt",
  packageName: "@veltdev/chat-sdk-adapter",
  peerDeps: [],
  readme:
    "https://github.com/velt-js/velt-chat-sdk-adapter/tree/9974db6ee24dc378987decc5c56cce95a12e7805/packages/chat-sdk-adapter",
  slug: "velt",
  type: "platform",
} as const satisfies CatalogAdapter;
