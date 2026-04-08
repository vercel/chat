# @chat-adapter/state-unstorage

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-unstorage)](https://www.npmjs.com/package/@chat-adapter/state-unstorage)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-unstorage)](https://www.npmjs.com/package/@chat-adapter/state-unstorage)

State adapter for [Chat SDK](https://chat-sdk.dev) built on top of [unstorage](https://unstorage.unjs.io/). It lets you use any unstorage-compatible backend behind the same Chat SDK state API.

## Installation

```bash
pnpm add @chat-adapter/state-unstorage unstorage
```

## Usage

```typescript
import { Chat } from "chat";
import { createUnstorageState } from "@chat-adapter/state-unstorage";
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";

const storage = createStorage({
  driver: redisDriver({
    base: "chat-sdk",
    url: process.env.REDIS_URL,
  }),
});

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createUnstorageState({ storage }),
});
```

You can also pass a driver directly:

```typescript
import memoryDriver from "unstorage/drivers/memory";

const state = createUnstorageState({
  driver: memoryDriver(),
  keyPrefix: "my-bot",
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `storage` | No | Existing unstorage instance |
| `driver` | No | unstorage driver used to create an internal storage instance |
| `keyPrefix` | No | Prefix for all keys (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

`storage` and `driver` are mutually exclusive.

## Compatibility

- Implements the full Chat SDK `StateAdapter` surface (`locks`, `subscriptions`, `cache`, `lists`, and `queues`)
- Works with any unstorage backend
- Preserves key prefix namespacing across multiple adapters sharing the same backend

## License

MIT
