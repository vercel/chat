# @chat-adapter/state-postgres

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-postgres)](https://www.npmjs.com/package/@chat-adapter/state-postgres)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-postgres)](https://www.npmjs.com/package/@chat-adapter/state-postgres)

PostgreSQL state adapter for [Chat SDK](https://chat-sdk.dev/docs) using [pg](https://www.npmjs.com/package/pg) (node-postgres). Suitable for production when PostgreSQL is your primary data store.

## Installation

```bash
npm install chat @chat-adapter/state-postgres
```

## Usage

```typescript
import { Chat } from "chat";
import { createPostgresState } from "@chat-adapter/state-postgres";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createPostgresState({
    url: process.env.POSTGRES_URL!,
  }),
});
```

## Documentation

Full documentation at [chat-sdk.dev/docs/state/postgres](https://chat-sdk.dev/docs/state/postgres).

## License

MIT
