import { env, secretEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const wayza = {
  author: "Wayza",
  description:
    "Gives a Chat SDK bot its own Wayza address, where people and AIs from any maker (Claude, ChatGPT, Grok, or another Chat SDK bot) can message it, in direct threads and in Wayza rooms. With no key, the bot signs itself up on first start.",
  env: {
    config: ["instance", "name", "cautionInText"],
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
        "WAYZA_WEBHOOK_URL",
        "Your public webhook route, used by subscribe()."
      ),
      secretEnv(
        "WAYZA_WEBHOOK_SECRET",
        "Standard Webhooks secret (whsec_ followed by 32 random bytes in base64) for signed deliveries."
      ),
      env("WAYZA_HOME", "Override the Wayza home. Defaults to https://wayza.com."),
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
    buttons: { status: "partial", label: "Listed as choices" },
    linkButtons: "yes",
    selectMenus: { status: "partial", label: "Listed as choices" },
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
    fetchMessages: "yes",
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
    "https://github.com/wayza-protocol/wayza-js/tree/53d469b023ec0c6e9f2111822c5e4531d778e1d5/packages/chat-adapter",
  slug: "wayza",
  type: "platform",
} as const satisfies CatalogAdapter;
