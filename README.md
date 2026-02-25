# Chat SDK

[![npm version](https://img.shields.io/npm/v/chat)](https://www.npmjs.com/package/chat)
[![npm downloads](https://img.shields.io/npm/dm/chat)](https://www.npmjs.com/package/chat)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, GitHub, and Linear. Write your bot logic once, deploy everywhere.

## Installation

```bash
npm install chat
```

Install adapters for your platforms:

```bash
npm install @chat-adapter/slack @chat-adapter/teams @chat-adapter/gchat @chat-adapter/discord
```

## Usage

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createRedisState(),
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Hello! I'm listening to this thread.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

See the [Getting Started guide](https://chat-sdk.dev/docs/getting-started) for a full walkthrough.

## Supported platforms

| Platform | Package | Mentions | Reactions | Cards | Modals | Streaming | DMs |
|----------|---------|----------|-----------|-------|--------|-----------|-----|
| Slack | `@chat-adapter/slack` | Yes | Yes | Yes | Yes | Native | Yes |
| Microsoft Teams | `@chat-adapter/teams` | Yes | Read-only | Yes | No | Post+Edit | Yes |
| Google Chat | `@chat-adapter/gchat` | Yes | Yes | Yes | No | Post+Edit | Yes |
| Discord | `@chat-adapter/discord` | Yes | Yes | Yes | No | Post+Edit | Yes |
| GitHub | `@chat-adapter/github` | Yes | Yes | No | No | No | No |
| Linear | `@chat-adapter/linear` | Yes | Yes | No | No | No | No |

## Features

- [**Event handlers**](https://chat-sdk.dev/docs/usage) — mentions, messages, reactions, button clicks, slash commands, modals
- [**AI streaming**](https://chat-sdk.dev/docs/streaming) — stream LLM responses with native Slack streaming and post+edit fallback
- [**Cards**](https://chat-sdk.dev/docs/cards) — JSX-based interactive cards (Block Kit, Adaptive Cards, Google Chat Cards)
- [**Actions**](https://chat-sdk.dev/docs/actions) — handle button clicks and dropdown selections
- [**Modals**](https://chat-sdk.dev/docs/modals) — form dialogs with text inputs, dropdowns, and validation
- [**Slash commands**](https://chat-sdk.dev/docs/slash-commands) — handle `/command` invocations
- [**Emoji**](https://chat-sdk.dev/docs/emoji) — type-safe, cross-platform emoji with custom emoji support
- [**File uploads**](https://chat-sdk.dev/docs/files) — send and receive file attachments
- [**Direct messages**](https://chat-sdk.dev/docs/direct-messages) — initiate DMs programmatically
- [**Ephemeral messages**](https://chat-sdk.dev/docs/ephemeral-messages) — user-only visible messages with DM fallback

## Packages

| Package | Description |
|---------|-------------|
| `chat` | Core SDK with `Chat` class, types, JSX runtime, and utilities |
| `@chat-adapter/slack` | [Slack adapter](https://chat-sdk.dev/docs/adapters/slack) |
| `@chat-adapter/teams` | [Teams adapter](https://chat-sdk.dev/docs/adapters/teams) |
| `@chat-adapter/gchat` | [Google Chat adapter](https://chat-sdk.dev/docs/adapters/gchat) |
| `@chat-adapter/discord` | [Discord adapter](https://chat-sdk.dev/docs/adapters/discord) |
| `@chat-adapter/github` | [GitHub adapter](https://chat-sdk.dev/docs/adapters/github) |
| `@chat-adapter/linear` | [Linear adapter](https://chat-sdk.dev/docs/adapters/linear) |
| `@chat-adapter/state-redis` | [Redis state adapter](https://chat-sdk.dev/docs/state/redis) (production) |
| `@chat-adapter/state-ioredis` | [ioredis state adapter](https://chat-sdk.dev/docs/state/ioredis) (alternative) |
| `@chat-adapter/state-memory` | [In-memory state adapter](https://chat-sdk.dev/docs/state/memory) (development) |

## AI coding agent support

If you use an AI coding agent like [Claude Code](https://docs.anthropic.com/en/docs/claude-code), you can teach it about Chat SDK:

```bash
npx skills add vercel/chat
```

## Documentation

Full documentation is available at [chat-sdk.dev/docs](https://chat-sdk.dev/docs).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and the release process.

## License

MIT
