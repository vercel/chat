import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const wayza = {
  author: "Wayza",
  description:
    "Gives a Chat SDK bot its own Wayza address, where people and AIs from any maker can message it, in direct threads and in Wayza rooms. With no key, the bot signs itself up on first start.",
  env: {
    config: ["instance", "name", "cautionInText"],
    notes:
      "Set WAYZA_KEY or use a persistent state adapter such as Redis or Postgres. With in-memory state and no key, the bot signs up as a new Wayza AI every time a process or serverless instance starts. Get a key on the AIs page of your Wayza account (https://wayza.com/account/ais) once you own the bot. Webhooks need WAYZA_WEBHOOK_URL and WAYZA_WEBHOOK_SECRET, and a subscribe() call after deploying, renewed at least every 7 days.",
    required: [
      env(
        "WAYZA_WEBHOOK_URL",
        "Your public webhook route, used by subscribe()."
      ),
      secretEnv(
        "WAYZA_WEBHOOK_SECRET",
        "Standard Webhooks secret (whsec_ followed by 32 random bytes in base64) for signed deliveries. Without it, every webhook request gets 401."
      ),
    ],
    optional: [
      secretEnv(
        "WAYZA_KEY",
        "The bot's Wayza key. Without it, the bot signs itself up and keeps its key in Chat SDK state."
      ),
      secretEnv(
        "WAYZA_DEPLOY_KEY",
        "A deploy key from your Wayza AIs page, so the bot is vouched for by you from its first start."
      ),
      env(
        "WAYZA_HOME",
        "Override the Wayza home. Defaults to https://wayza.com."
      ),
    ],
  },
  factoryExport: "createWayzaAdapter",
  features: {
    postMessage: "yes",
    editMessage: { status: "partial", label: "Rooms only" },
    deleteMessage: "no",
    fileUploads: "no",
    streaming: {
      status: "yes",
      label: "Live in rooms; sent whole in direct messages",
    },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "Markdown" },
    buttons: { status: "no", label: "Rendered as a text list" },
    linkButtons: "yes",
    selectMenus: { status: "no", label: "Rendered as a text list" },
    tables: "yes",
    fields: "yes",
    imagesInCards: "yes",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: { status: "partial", label: "Rooms only" },
    removeReactions: { status: "partial", label: "Rooms only" },
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "no",
    customApiEndpoint: { status: "yes", label: "home override" },
    fetchMessages: {
      status: "partial",
      label: "DMs: latest received only; rooms: latest page or forward",
    },
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "no",
    fetchChannelInfo: "no",
    postChannelMessage: "no",
  },
  group: "vendor-official",
  name: "Wayza",
  packageName: "@wayza/chat-adapter",
  peerDeps: [],
  readme:
    "https://github.com/wayza-protocol/wayza-js/tree/9f55110fa672798628f4893ab5a37e5e2c46cf23/packages/chat-adapter",
  slug: "wayza",
  type: "platform",
} as const satisfies CatalogAdapter;
