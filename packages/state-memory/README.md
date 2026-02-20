# @chat-adapter/state-memory

In-memory state adapter for [Chat SDK](https://chat-sdk.dev/docs). For development and testing only — state is lost on restart.

## Installation

```bash
npm install chat @chat-adapter/state-memory
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

## Documentation

Full documentation at [chat-sdk.dev/docs/state/memory](https://chat-sdk.dev/docs/state/memory).

For production, use [Redis](https://chat-sdk.dev/docs/state/redis) or [ioredis](https://chat-sdk.dev/docs/state/ioredis).

## License

MIT
