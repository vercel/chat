import { secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const webhook = {
  beta: true,
  description:
    "Connect any platform that delivers messages as HTTP webhooks and accepts replies over HTTP, with your own parse and send functions.",
  env: {
    config: [
      "parse",
      "send",
      "edit",
      "delete",
      "startTyping",
      "verify",
      "signatureHeader",
      "name",
      "userName",
    ],
    notes:
      "Set WEBHOOK_SECRET for HMAC-SHA256 signature verification, or pass a verify function for platforms that authenticate requests differently.",
    optional: [
      secretEnv(
        "WEBHOOK_SECRET",
        "Shared secret for HMAC-SHA256 webhook signature verification."
      ),
    ],
  },
  factoryExport: "createWebhookAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial", label: "With edit callback" },
    deleteMessage: { status: "partial", label: "With delete callback" },
    fileUploads: { status: "partial", label: "Via send callback" },
    streaming: { status: "partial", label: "Buffered, or post+edit" },
    scheduledMessages: "no",
    cardFormat: { status: "partial", label: "Markdown fallback" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "yes", label: "GFM" },
    fields: { status: "partial", label: "Markdown fallback" },
    imagesInCards: "no",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "no",
    removeReactions: "no",
    typingIndicator: { status: "partial", label: "With startTyping callback" },
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "no",
    ephemeralMessages: "no",
    customApiEndpoint: "yes",
    fetchMessages: { status: "partial", label: "State cache" },
    fetchThreadInfo: { status: "yes", label: "Synthesized" },
    fetchChannelMessages: { status: "partial", label: "State cache" },
    listThreads: "no",
    postChannelMessage: "no",
  },
  group: "official",
  name: "Webhook",
  packageName: "@chat-adapter/webhook",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-webhook",
  slug: "webhook",
  type: "platform",
} as const satisfies CatalogAdapter;
