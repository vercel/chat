import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const discord = {
  beta: true,
  description:
    "Create Discord bots with slash commands, threads, and rich embeds.",
  env: {
    optional: [
      env(
        "DISCORD_MENTION_ROLE_IDS",
        "Comma-separated role IDs that should trigger mention handlers."
      ),
      env(
        "DISCORD_RESPOND_TO_CHANNEL_IDS",
        "Comma-separated parent channel IDs whose non-bot messages trigger mention handlers without an @mention."
      ),
      urlEnv("DISCORD_API_URL", "Override the Discord API base URL."),
    ],
    required: [
      secretEnv("DISCORD_BOT_TOKEN", "Discord bot token."),
      env("DISCORD_PUBLIC_KEY", "Application public key."),
      env("DISCORD_APPLICATION_ID", "Discord application ID."),
    ],
  },
  factoryExport: "createDiscordAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "yes",
    streaming: { status: "partial", label: "Post+Edit" },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "Embeds / Components" },
    buttons: "yes",
    linkButtons: "yes",
    selectMenus: { status: "partial", label: "Components" },
    tables: { status: "yes", label: "GFM" },
    fields: "yes",
    imagesInCards: "yes",
    modals: "no",
    slashCommands: "yes",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "yes",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "yes",
    customApiEndpoint: "yes",
    fetchMessages: "yes",
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "official",
  icon: "discord",
  name: "Discord",
  packageName: "@chat-adapter/discord",
  peerDeps: ["discord-api-types", "discord-interactions", "discord.js"],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-discord",
  slug: "discord",
  type: "platform",
} as const satisfies CatalogAdapter;
