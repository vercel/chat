# @chat-adapter/state-memory

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-memory)](https://www.npmjs.com/package/@chat-adapter/state-memory)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-memory)](https://www.npmjs.com/package/@chat-adapter/state-memory)

In-memory state adapter for [Chat SDK](https://chat-sdk.dev). For development and testing only — state is lost on restart.

> **Warning:** Only use the memory adapter for local development and testing. State is lost on restart and locks don't work across multiple instances. For production, use [@chat-adapter/state-redis](https://github.com/vercel/chat/tree/main/packages/state-redis), [@chat-adapter/state-ioredis](https://github.com/vercel/chat/tree/main/packages/state-ioredis), or [@chat-adapter/state-pg](https://github.com/vercel/chat/tree/main/packages/state-pg).

## Installation

```bash
pnpm add @chat-adapter/state-memory
```

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

## License

MIT
