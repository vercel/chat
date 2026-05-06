# Chat SDK

[![npm version](https://img.shields.io/npm/v/chat)](https://www.npmjs.com/package/chat)
[![npm downloads](https://img.shields.io/npm/dm/chat)](https://www.npmjs.com/package/chat)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, Telegram, GitHub, Linear, and WhatsApp. Write your bot logic once, deploy everywhere.

## Installation

```bash
npm install chat
```

Install adapters for your platforms:

```bash
npm install @chat-adapter/slack @chat-adapter/teams @chat-adapter/gchat @chat-adapter/discord @chat-adapter/telegram
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

## Adapters

Browse official, vendor-official, and community adapters on [chat-sdk.dev/adapters](https://chat-sdk.dev/adapters). A cross-platform feature matrix is available at [chat-sdk.dev/docs/adapters](https://chat-sdk.dev/docs/adapters).

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
- [**Overlapping messages**](https://chat-sdk.dev/docs/concurrency) — queue, debounce, drop, or process concurrent messages on the same thread

## AI coding agent support

If you use an AI coding agent like [Claude Code](https://docs.anthropic.com/en/docs/claude-code), you can teach it about Chat SDK:

```bash
npx skills add vercel/chat
```

## Documentation

Full documentation is available at [chat-sdk.dev/docs](https://chat-sdk.dev/docs).

## Contributing

See [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for development setup and the release process.

## Support

For help or questions, see [SUPPORT.md](./.github/SUPPORT.md). To report a security vulnerability, see [SECURITY.md](./.github/SECURITY.md).

## License

MIT
