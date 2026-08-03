[![Discord adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/discord/og)](https://chat-sdk.dev/adapters/official/discord)

# @chat-adapter/discord

> npm package: [`@chat-adapter/discord`](https://www.npmjs.com/package/@chat-adapter/discord)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Discord adapter for [Chat SDK](https://chat-sdk.dev). Configure with HTTP Interactions and Gateway WebSocket support.

Documentation: [chat-sdk.dev/adapters/official/discord](https://chat-sdk.dev/adapters/official/discord) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/discord
```

## Scaffold with the CLI

To scaffold a new Discord bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter discord memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

The adapter auto-detects `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_MENTION_ROLE_IDS` from environment variables:

```typescript
import { Chat } from "chat";
import { createDiscordAdapter } from "@chat-adapter/discord";

const discord = createDiscordAdapter();
const bot = new Chat({
  userName: "mybot",
  adapters: {
    discord,
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Discord!");
});
```

## Discord application setup

### 1. Create application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Note the **Application ID** from the General Information page
4. Copy the **Public Key** from the General Information page

### 2. Create bot

1. Go to the **Bot** section in the left sidebar
2. Click **Reset Token** to generate a new bot token
3. Copy and save the token (you won't see it again)
4. Enable these **Privileged Gateway Intents**:
   - Message Content Intent
   - Server Members Intent (if needed)

### 3. Configure interactions endpoint

1. Go to **General Information**
2. Set **Interactions Endpoint URL** to `https://your-domain.com/api/webhooks/discord`
3. Discord sends a PING to verify the endpoint

### 4. Add bot to server

1. Go to **OAuth2** then **URL Generator**
2. Select scopes: `bot`, `applications.commands`
3. Select bot permissions: Send Messages, Send Messages in Threads, Create Public Threads, Manage Threads, Read Message History, Add Reactions, Attach Files
4. Copy the generated URL and open it to invite the bot to your server

## Architecture: HTTP Interactions vs Gateway

Discord has two ways to receive events:

**HTTP Interactions (default):**
- Receives button clicks, slash commands, and verification pings
- Works out of the box with serverless
- Does **not** receive regular messages

**Gateway WebSocket (required for messages):**
- Receives regular messages and reactions
- Receives slash commands and button clicks when no Interactions Endpoint URL is configured
- Requires a persistent connection
- In serverless environments, use a cron job to maintain the connection

Discord sends interactions through either the Gateway or an Interactions Endpoint URL, not both. Use the HTTP endpoint for serverless apps. For resident gateway-only apps, leave the Interactions Endpoint URL unset and start the Gateway listener without `webhookUrl` so interactions are processed directly.

## Gateway setup for serverless

### 1. Create Gateway route

```typescript
import { after } from "next/server";
import { bot } from "@/lib/bot";

export const maxDuration = 800;

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const durationMs = 600 * 1000;
  const webhookUrl = `https://${process.env.VERCEL_URL}/api/webhooks/discord`;

  await bot.initialize();

  const discord = bot.getAdapter("discord");

  return discord.startGatewayListener(
    { waitUntil: (task) => after(() => task) },
    durationMs,
    undefined,
    webhookUrl
  );
}
```

### 2. Configure Vercel Cron

```json
{
  "crons": [
    {
      "path": "/api/discord/gateway",
      "schedule": "*/9 * * * *"
    }
  ]
}
```

This runs every 9 minutes, ensuring overlap with the 10-minute listener duration.

### 3. Add environment variables

Add `CRON_SECRET` to your Vercel project settings.

## Role mentions

By default, only direct user mentions (`@BotName`) trigger `onNewMention` handlers. To also trigger on role mentions (e.g., `@AI`):

1. Create a role in your Discord server (e.g., "AI")
2. Assign the role to your bot
3. Copy the role ID (right-click role in server settings with Developer Mode enabled)
4. Add to `mentionRoleIds`:

```typescript
createDiscordAdapter({
  mentionRoleIds: ["1457473602180878604"],
});
```

Or set `DISCORD_MENTION_ROLE_IDS` as a comma-separated string in your environment variables.

## Interaction flags

Discord interactions return a transient "thinking..." message, which then gets replaced with your content. Because of Discord's API, your message's ephemerality must be set on this initial response, not later in an `onSlashCommand` handler.

Use the `interactionFlags` option to make the loading state and your custom response visible only to the user who invoked the command:

```typescript
import {
  createDiscordAdapter,
  DiscordInteractionResponseFlag,
} from "@chat-adapter/discord";

createDiscordAdapter({
  interactionFlags: ({ command }) => {
    if (command === "/admin") {
      return DiscordInteractionResponseFlag.Ephemeral;
    }
  },
});
```

Later calls to `event.channel.post()` will share the same ephemeral message.
Calls to `event.channel.postEphemeral()` will fallback to a private DM.

## Components v2 cards

Discord cards render as embeds by default. To render Chat SDK cards with
[Discord Components v2](https://docs.discord.com/developers/components/reference) instead, set `contentFormat`:

```typescript
import { DiscordContentFormat } from "@chat-adapter/discord";

createDiscordAdapter({
  contentFormat: DiscordContentFormat.ComponentsV2,
});
```

When enabled, card messages use Discord's `IS_COMPONENTS_V2` flag and render
with components such as containers, sections, text displays, media galleries,
buttons, and string selects. Plain text messages still use Discord message
content.

Discord caps a Components v2 message at 40 total components and 4000 characters
across all text. When a card exceeds either limit the adapter throws a
`ValidationError` rather than letting Discord reject the request.

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | No* | Discord bot token. Auto-detected from `DISCORD_BOT_TOKEN` |
| `publicKey` | No* | Application public key. Auto-detected from `DISCORD_PUBLIC_KEY` |
| `applicationId` | No* | Discord application ID. Auto-detected from `DISCORD_APPLICATION_ID` |
| `contentFormat` | No | Render Chat SDK cards as `DiscordContentFormat.Embeds` or `DiscordContentFormat.ComponentsV2`. Defaults to `DiscordContentFormat.Embeds` |
| `mentionRoleIds` | No | Array of role IDs that trigger mention handlers. Auto-detected from `DISCORD_MENTION_ROLE_IDS` (comma-separated) |
| `respondToChannelIds` | No | Parent channel IDs whose non-bot messages, including messages in child threads, trigger mention handlers without an @mention. Top-level messages use the adapter's normal per-message Discord thread. Auto-detected from `DISCORD_RESPOND_TO_CHANNEL_IDS` (comma-separated). Defaults to `[]` |
| `respondToGlobalMentions` | No | Treat `@everyone`/`@here` pings as mentions of the bot. Defaults to `false` |
| `interactionFlags` | No | Function returning Discord interaction flags for the initial deferred slash command response |
| `apiUrl` | No | Override the Discord API base URL. Auto-detected from `DISCORD_API_URL` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*`botToken`, `publicKey`, and `applicationId` are required — either via config or env vars.

## Discord thread channel names

Call `discord.setThreadTitle(thread.id, title)` to rename an existing Discord thread channel. The bot needs the **Manage Threads** permission.

## Environment variables

```bash
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_PUBLIC_KEY=your-application-public-key
DISCORD_APPLICATION_ID=your-application-id
DISCORD_MENTION_ROLE_IDS=1234567890,0987654321  # Optional
DISCORD_API_URL=...                              # Optional, override the Discord API base URL
CRON_SECRET=your-random-secret                   # For Gateway cron
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | Yes |
| Streaming | Post+Edit fallback |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Embeds by default, Components v2 when enabled |
| Buttons | Yes |
| Link buttons | Yes |
| Select menus | Components v2 |
| Tables | GFM |
| Fields | Yes |
| Images in cards | Yes |
| Modals | No |

### Conversations

| Feature | Supported |
|---------|-----------|
| Slash commands | Yes |
| Mentions | Yes |
| Add reactions | Yes |
| Remove reactions | Yes |
| Typing indicator | Yes |
| DMs | Yes |
| Ephemeral messages | No (DM fallback) |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Yes |
| Fetch single message | No |
| Fetch thread info | Yes |
| Fetch channel messages | Yes |
| List threads | Yes |
| Fetch channel info | Yes |
| Post channel message | Yes |

## Testing

Run a local tunnel (e.g., ngrok) to test webhooks locally:

```bash
ngrok http 3000
```

Update the Interactions Endpoint URL in the Discord Developer Portal to your ngrok URL.

## Troubleshooting

### Bot not responding to messages

1. **Check Gateway connection**: Messages require the Gateway WebSocket, not just HTTP interactions
2. **Verify Message Content Intent**: Enable this in the Bot settings
3. **Check bot permissions**: Ensure the bot can read messages in the channel

### Role mentions not triggering

1. **Verify role ID**: Enable Developer Mode in Discord settings, then right-click the role
2. **Check `mentionRoleIds` config**: Ensure the role ID is in the array
3. **Confirm bot has the role**: The bot must have the role assigned

### Signature verification failing

1. **Check public key format**: Should be a 64-character hex string (lowercase)
2. **Verify endpoint URL**: Must exactly match what's configured in Discord Developer Portal
3. **Check for body parsing**: Don't parse the request body before verification

## Resources

- [Create a Discord support bot with Nuxt and Redis](https://vercel.com/kb/guide/create-a-discord-support-bot-with-nuxt-and-redis?utm_source=chat-sdk_repo&utm_medium=readme&utm_campaign=adapter-discord&utm_content=create-a-discord-support-bot-with-nuxt-and-redis) — Walks through building a Discord support bot with Nuxt, covering project setup, Discord app configuration, Gateway forwarding, AI-powered responses, and deployment.

See all guides and templates at [chat-sdk.dev/resources](https://chat-sdk.dev/resources?utm_source=chat-sdk_repo&utm_medium=readme&utm_campaign=adapter-discord&utm_content=resources).

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit — it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
