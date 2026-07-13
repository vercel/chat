# Chat SDK

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](LICENSE)

Unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, Telegram, GitHub, Linear, WhatsApp, and more. **Write your bot logic once, deploy everywhere.**

## Installation

```bash
npm i chat
```

Install one or more adapters for your platforms:

```bash
npm install @chat-adapter/slack @chat-adapter/teams @chat-adapter/gchat
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

Browse official, vendor-official, and community adapters on [chat-sdk.dev/adapters](https://chat-sdk.dev/adapters). Learn how to [build your own adapter](https://chat-sdk.dev/docs/contributing/building).

## Features

- [**Event handlers**](https://chat-sdk.dev/docs/usage) — mentions, messages, reactions, button clicks, slash commands, modals
- [**AI streaming**](https://chat-sdk.dev/docs/streaming) — stream LLM responses with native Slack streaming, Telegram private chat draft previews, and post+edit fallback
- [**Cards**](https://chat-sdk.dev/docs/cards) — JSX-based interactive cards (Block Kit, Adaptive Cards, Google Chat Cards)
- [**Actions**](https://chat-sdk.dev/docs/actions) — handle button clicks and dropdown selections
- [**Modals**](https://chat-sdk.dev/docs/modals) — form dialogs with text inputs, dropdowns, and validation
- [**Slash commands**](https://chat-sdk.dev/docs/slash-commands) — handle `/command` invocations
- [**Emoji**](https://chat-sdk.dev/docs/emoji) — type-safe, cross-platform emoji with custom emoji support
- [**File uploads**](https://chat-sdk.dev/docs/files) — send and receive file attachments
- [**Direct messages**](https://chat-sdk.dev/docs/direct-messages) — initiate DMs programmatically
- [**Ephemeral messages**](https://chat-sdk.dev/docs/ephemeral-messages) — user-only visible messages with DM fallback
- [**Overlapping messages**](https://chat-sdk.dev/docs/concurrency) - burst, queue, debounce, drop, or process concurrent messages on the same thread

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/plugin) for a broader agent toolkit. It includes the Chat SDK skill alongside specialist agents, slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## Documentation

Full documentation is available at [chat-sdk.dev/docs](https://chat-sdk.dev/docs) and guides are available in the [Vercel Knowledge Base](https://vercel.com/kb/chat-sdk).

## Contributing

See [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for guidance on contributing to Chat SDK.

## Support

For help or questions, see [SUPPORT.md](./.github/SUPPORT.md).

To report a security vulnerability, see [SECURITY.md](./.github/SECURITY.md).

## License

MIT

[![Made by Vercel](https://img.shields.io/badge/Made%20By%20Vercel-000?style=flat-square&logo=vercel&logoColor=white&labelColor=000&color=000)](https://vercel.com)
