# @chat-adapter/state-ioredis

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-ioredis)](https://www.npmjs.com/package/@chat-adapter/state-ioredis)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-ioredis)](https://www.npmjs.com/package/@chat-adapter/state-ioredis)

Alternative Redis state adapter for [Chat SDK](https://chat-sdk.dev) using [ioredis](https://www.npmjs.com/package/ioredis). Use this if you already have ioredis in your project or need Redis Cluster/Sentinel support.

## Installation

```bash
pnpm add @chat-adapter/state-ioredis
```

## Usage

```typescript
import { Chat } from "chat";
import { createIORedisState } from "@chat-adapter/state-ioredis";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createIORedisState({
    url: process.env.REDIS_URL!,
  }),
});
```

### Using an existing client

```typescript
import Redis from "ioredis";

const client = new Redis("redis://localhost:6379");

const state = createIORedisState({ client });
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `url` | Yes* | Redis connection URL |
| `client` | No | Existing `ioredis` client instance |
| `keyPrefix` | No | Prefix for all keys (default: `"chat-sdk"`) |

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

## License

MIT
