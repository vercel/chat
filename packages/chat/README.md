# Chat SDK

> npm package: [`chat`](https://www.npmjs.com/package/chat)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Universal TypeScript SDK for building multi-platform chat bots and AI agents on Slack, Teams, Google Chat, Discord, WhatsApp, and more. Provides the `Chat` class, event handlers, JSX cards, emoji helpers, and type-safe message formatting.

Documentation: [chat-sdk.dev/docs](https://chat-sdk.dev/docs) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
npm install chat
```

## CLI

Scaffold a minimal Next.js bot app with `create-chat-sdk`:

```bash
npx create-chat-sdk@latest my-bot
```

The CLI generates your `Chat` configuration, webhook route, `.env.example` file, dependencies, and optional Web adapter route from the adapter catalog. See the [CLI docs](https://chat-sdk.dev/docs/create-chat-sdk) for options and non-interactive usage.

## Usage

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
  state: createRedisState({ url: process.env.REDIS_URL! }),
  dedupeTtlMs: 600_000, // 10 minutes (default: 5 min)
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Hello! I'm listening to this thread.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

> **Tip:** PostgreSQL and ioredis adapters are also available for production. See [State Adapters](https://chat-sdk.dev/docs/state-adapters) for all options.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `userName` | `string` | **required** | Default bot username across all adapters |
| `adapters` | `Record<string, Adapter>` | **required** | Map of adapter name to adapter instance |
| `state` | `StateAdapter` | **required** | State adapter for subscriptions, locking, and dedup |
| `logger` | `Logger \| LogLevel` | `"info"` | Logger instance or log level (`"silent"` to disable) |
| `streamingUpdateIntervalMs` | `number` | `500` | Update interval for fallback streaming (post + edit) in ms |
| `dedupeTtlMs` | `number` | `300000` | TTL for message deduplication entries in ms. Increase if webhook cold starts cause platform retries (e.g., Slack's `http_timeout` retry) that arrive after the default window |

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

## Documentation

Full documentation is available at [chat-sdk.dev/docs](https://chat-sdk.dev/docs).

- [Usage](https://chat-sdk.dev/docs/usage) — event handlers, threads, messages, channels
- [Chat API](https://chat-sdk.dev/docs/api/chat) — full `Chat` class reference
- [Cards](https://chat-sdk.dev/docs/cards) — JSX-based interactive cards
- [Streaming](https://chat-sdk.dev/docs/streaming) — AI SDK integration
- [Emoji](https://chat-sdk.dev/docs/emoji) — cross-platform emoji helpers

## License

MIT
