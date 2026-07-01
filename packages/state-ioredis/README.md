# @chat-adapter/state-ioredis

> npm package: [`@chat-adapter/state-ioredis`](https://www.npmjs.com/package/@chat-adapter/state-ioredis)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Alternative Redis state adapter for [Chat SDK](https://chat-sdk.dev) using [ioredis](https://www.npmjs.com/package/ioredis). Use this if you already have ioredis in your project or need Redis Cluster/Sentinel support.

Documentation: [chat-sdk.dev/adapters/official/ioredis](https://chat-sdk.dev/adapters/official/ioredis) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/state-ioredis
```

## Scaffold with the CLI

To scaffold a new Slack bot that uses ioredis for state:

```bash
npx create-chat-sdk@latest my-bot --adapter slack ioredis
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createIoRedisState } from "@chat-adapter/state-ioredis";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createIoRedisState({
    url: process.env.REDIS_URL!,
  }),
});
```

### Using an existing client

```typescript
import Redis from "ioredis";

const client = new Redis("redis://localhost:6379");

const state = createIoRedisState({ client });
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `url` | Yes* | Redis connection URL |
| `client` | No | Existing `ioredis` client instance |
| `keyPrefix` | No | Prefix for all keys (default: `"chat-sdk"`) |
| `logger` | No | Logger for error reporting (default: console logger) |

*Either `url` or `client` is required.

## When to use ioredis vs redis

**Use `@chat-adapter/state-ioredis` when:**

- You already use ioredis in your project
- You need Redis Cluster support
- You need Redis Sentinel support
- You prefer the ioredis API

**Use `@chat-adapter/state-redis` when:**

- You want the official Redis client
- You're starting a new project
- You don't need Cluster or Sentinel

## Key structure

```
{keyPrefix}:subscriptions     - SET of subscribed thread IDs
{keyPrefix}:lock:{threadId}   - Lock key with TTL
```

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Multi-instance | Yes |
| Subscriptions | Yes |
| Distributed locking | Yes |
| Key-value caching | Yes |
| Automatic reconnection | Yes |
| Redis Cluster support | Yes |
| Redis Sentinel support | Yes |
| Key prefix namespacing | Yes |

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
