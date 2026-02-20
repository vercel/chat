# @chat-adapter/state-redis

Redis state adapter for [Chat SDK](https://chat-sdk.dev/docs) using the official [redis](https://www.npmjs.com/package/redis) package. Recommended for production.

## Installation

```bash
npm install chat @chat-adapter/state-redis
```

## Usage

```typescript
import { Chat } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createRedisState({
    url: process.env.REDIS_URL!,
  }),
});
```

## Documentation

Full documentation at [chat-sdk.dev/docs/state/redis](https://chat-sdk.dev/docs/state/redis).

## License

MIT
