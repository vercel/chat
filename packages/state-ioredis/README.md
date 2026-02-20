# @chat-adapter/state-ioredis

Redis state adapter for [Chat SDK](https://chat-sdk.dev/docs) using [ioredis](https://www.npmjs.com/package/ioredis). Use this if you need Redis Cluster or Sentinel support.

## Installation

```bash
npm install chat @chat-adapter/state-ioredis
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

## Documentation

Full documentation at [chat-sdk.dev/docs/state/ioredis](https://chat-sdk.dev/docs/state/ioredis).

## License

MIT
