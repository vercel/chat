# @chat-adapter/state-redis

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-redis)](https://www.npmjs.com/package/@chat-adapter/state-redis)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-redis)](https://www.npmjs.com/package/@chat-adapter/state-redis)

Production state adapter for [Chat SDK](https://chat-sdk.dev) using the official [redis](https://www.npmjs.com/package/redis) package.

## Installation

```bash
pnpm add @chat-adapter/state-redis
```

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

## License

MIT
