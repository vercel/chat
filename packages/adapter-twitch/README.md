[![Twitch adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/twitch/og)](https://chat-sdk.dev/adapters/official/twitch)

# @chat-adapter/twitch

> npm package: [`@chat-adapter/twitch`](https://www.npmjs.com/package/@chat-adapter/twitch)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Twitch adapter for [Chat SDK](https://chat-sdk.dev), using [EventSub webhooks](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/) and the [Twitch API](https://dev.twitch.tv/docs/api/reference/). Read and reply in channel chat as a bot account, delete messages as a moderator, and send and receive whispers.

Documentation: [chat-sdk.dev/adapters/official/twitch](https://chat-sdk.dev/adapters/official/twitch) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/twitch
```

## Scaffold with the CLI

To scaffold a new Twitch bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter twitch memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createTwitchAdapter } from "@chat-adapter/twitch";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    twitch: createTwitchAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.reply(message, `Hi @${message.author.userName}!`);
});

bot.onDirectMessage(async (thread) => {
  await thread.post("Thanks for the whisper!");
});
```

When you call `createTwitchAdapter()` without arguments, it reads credentials from environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `TWITCH_CLIENT_ID` | Yes | Twitch application client ID |
| `TWITCH_CLIENT_SECRET` | Yes | Twitch application client secret |
| `TWITCH_WEBHOOK_SECRET` | Yes | EventSub webhook secret, 10 to 100 characters |
| `TWITCH_BOT_USERNAME` | Yes, unless `TWITCH_BOT_USER_ID` is set | Bot account login |
| `TWITCH_BOT_USER_ID` | No | Bot account user ID. Looked up from the login when unset. Set it with `TWITCH_BOT_USERNAME` to skip the Get Users call on startup |
| `TWITCH_USER_ACCESS_TOKEN` | For whispers, unless `TWITCH_REFRESH_TOKEN` is set | Bot user access token with `user:manage:whispers` |
| `TWITCH_REFRESH_TOKEN` | No | Bot refresh token for managed whisper token refresh |
| `TWITCH_ENCRYPTION_KEY` | No | Base64 32-byte key used to encrypt the tokens stored in the state adapter |

## Twitch setup

1. Create a Twitch account for the bot and register an application in the [Twitch developer console](https://dev.twitch.tv/console/apps). Set the OAuth redirect URL to `http://localhost:3000`, which the Twitch CLI uses in the next step, and choose the Confidential client type.
2. Sign in as the bot and authorize the application with `user:read:chat`, `user:write:chat`, and `user:bot`. Add `moderator:manage:chat_messages` to delete messages and `user:manage:whispers` for whispers. The [Twitch CLI](https://dev.twitch.tv/docs/cli/token-command/) can run this flow: `twitch token --user-token --scopes "user:read:chat user:write:chat user:bot"`.
3. For each channel, have the broadcaster authorize the application with `channel:bot`, or make the bot a moderator.
4. Deploy a webhook route that calls `bot.webhooks.twitch(request)`, then create the EventSub subscriptions once:

```typescript
await bot.initialize();
const twitch = bot.getAdapter("twitch");
await twitch.subscribeToChat("<broadcaster user ID>", "https://your-domain.com/api/webhooks/twitch");
await twitch.subscribeToWhispers("https://your-domain.com/api/webhooks/twitch");
```

Chat uses an app access token that the adapter mints and refreshes with the client credentials grant. Only whispers need a user access token.

## Behavior

- **Threads:** a broadcaster's chat room is one thread, `twitch:{broadcasterUserId}`. Whispers use `twitch:whisper:{userId}`.
- **Mentions:** an `@mention` of the bot or a reply to one of its messages counts as a mention. The bot's own messages are ignored.
- **Replies:** `thread.reply(message, ...)` sends a Twitch reply with `reply_parent_message_id`. On incoming replies, `message.replyTo` holds the text and author of the message being replied to.
- **Formatting:** messages are sent as one line of plain text. Card parts and table rows are joined with ` · `, and messages over 500 characters are cut at a word boundary.
- **Concurrency:** the adapter locks a whole chat room while a handler runs. Set `concurrency: "queue"` or `"concurrent"` on `Chat` so messages that arrive during a slow reply aren't dropped.
- **History:** Twitch has no history API. Chat SDK keeps thread history in the state adapter (`persistThreadHistory`).
- **Streaming:** buffered and posted once, because Twitch chat messages can't be edited.
- **Unsupported:** editing, reactions, typing indicators, file uploads, and interactive components.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit: it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
