# @chat-adapter/state-redis

> npm package: [`@chat-adapter/state-redis`](https://www.npmjs.com/package/@chat-adapter/state-redis)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Production state adapter for [Chat SDK](https://chat-sdk.dev) using the official [redis](https://www.npmjs.com/package/redis) package.

Documentation: [chat-sdk.dev/adapters/official/redis](https://chat-sdk.dev/adapters/official/redis) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/state-redis
```

## Scaffold with the CLI

To scaffold a new Slack bot that uses Redis for state:

```bash
npx create-chat-sdk@latest my-bot --adapter slack redis
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

`createRedisState()` auto-detects the `REDIS_URL` environment variable, so you can call it with no arguments:

```typescript
import { Chat } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createRedisState(),
});
```

To provide a URL explicitly:

```typescript
const state = createRedisState({ url: "redis://localhost:6379" });
```

### Using an existing client

If you already have a connected Redis client, pass it directly:

```typescript
import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379" });
await client.connect();

const state = createRedisState({ client });
```

### Key prefix

All keys are namespaced under a configurable prefix (default: `"chat-sdk"`):

```typescript
const state = createRedisState({
  url: process.env.REDIS_URL!,
  keyPrefix: "my-bot",
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `url` | No* | Redis connection URL (auto-detected from `REDIS_URL`) |
| `client` | No | Existing `redis` client instance |
| `keyPrefix` | No | Prefix for all keys (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*Either `url`, `REDIS_URL` env var, or `client` is required.

## Environment variables

```bash
REDIS_URL=redis://localhost:6379
```

For serverless deployments (Vercel, AWS Lambda), use a serverless-compatible Redis provider like [Upstash](https://upstash.com).

## Key structure

```
{keyPrefix}:subscriptions     - SET of subscribed thread IDs
{keyPrefix}:lock:{threadId}   - Lock key with TTL
```

## Production recommendations

- Use Redis 6.0+ for best performance
- Enable Redis persistence (RDB or AOF)
- Use Redis Cluster for high availability
- Set appropriate memory limits

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Multi-instance | Yes |
| Subscriptions | Yes |
| Distributed locking | Yes |
| Key-value caching | Yes |
| Automatic reconnection | Yes |
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
