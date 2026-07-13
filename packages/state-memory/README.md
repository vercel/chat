# @chat-adapter/state-memory

> npm package: [`@chat-adapter/state-memory`](https://www.npmjs.com/package/@chat-adapter/state-memory)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

In-memory state adapter for [Chat SDK](https://chat-sdk.dev). For development and testing only — state is lost on restart.

> **Warning:** Only use the memory adapter for local development and testing. State is lost on restart and locks don't work across multiple instances. For production, use [@chat-adapter/state-redis](https://github.com/vercel/chat/tree/main/packages/state-redis), [@chat-adapter/state-ioredis](https://github.com/vercel/chat/tree/main/packages/state-ioredis), or [@chat-adapter/state-pg](https://github.com/vercel/chat/tree/main/packages/state-pg).

Documentation: [chat-sdk.dev/adapters/official/memory](https://chat-sdk.dev/adapters/official/memory) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/state-memory
```

## Scaffold with the CLI

To scaffold a local-development Slack bot that uses in-memory state:

```bash
npx create-chat-sdk@latest my-bot --adapter slack memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createMemoryState(),
});
```

No configuration options are needed.

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | No |
| Multi-instance | No |
| Subscriptions | Yes (in-memory) |
| Locking | Yes (single-process only) |
| Key-value caching | Yes (in-memory) |
| Zero configuration | Yes |

## Limitations

- **Not suitable for production** — state is lost on restart
- **Single process only** — locks don't work across multiple instances
- **No persistence** — subscriptions reset when the process restarts

## When to use

- Local development
- Unit testing
- Quick prototyping

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
