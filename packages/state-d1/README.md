# @chat-adapter/state-d1

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-d1)](https://www.npmjs.com/package/@chat-adapter/state-d1)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-d1)](https://www.npmjs.com/package/@chat-adapter/state-d1)

Cloudflare [D1](https://developers.cloudflare.com/d1/) (SQLite) state adapter for [Chat SDK](https://chat-sdk.dev). Use this when you run your bot on Cloudflare Workers and want durable state persistence backed by D1 — without provisioning a separate Redis or Postgres.

## Installation

```bash
pnpm add @chat-adapter/state-d1
```

## Usage

The D1 binding is always injected — pass the `DB` binding from your Worker `env`:

```typescript
import { Chat } from "chat";
import { createD1State } from "@chat-adapter/state-d1";

export default {
  async fetch(request: Request, env: Env) {
    const bot = new Chat({
      userName: "mybot",
      adapters: {
        /* ... */
      },
      state: createD1State({ database: env.DB }),
    });

    // ...handle the request
  },
};
```

### Wrangler D1 binding

Declare the D1 binding in your `wrangler.jsonc` (or `wrangler.toml`):

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "chat-state",
      "database_id": "<your-d1-database-id>"
    }
  ]
}
```

The binding name (`DB` above) must match the property you read from `env`. The adapter creates all of its tables automatically on `connect()`, so no manual migrations are required.

## Configuration

| Option      | Required | Description                                                            |
| ----------- | -------- | ---------------------------------------------------------------------- |
| `database`  | Yes      | The Cloudflare D1 binding (`env.DB`)                                    |
| `keyPrefix` | No       | Prefix that namespaces all rows (default: `"chat-sdk"`)                |
| `logger`    | No       | Logger instance (defaults to `ConsoleLogger("info").child("d1")`)      |

## Data model

The adapter creates these tables automatically on `connect()`:

```sql
chat_state_subscriptions
chat_state_locks
chat_state_cache
chat_state_lists
chat_state_queues
```

All rows are namespaced by `key_prefix`, so multiple logical adapters can share one D1 database by using different `keyPrefix` values. All timestamps are stored as integer Unix-milliseconds.

## Features

| Feature                  | Supported       |
| ------------------------ | --------------- |
| Persistence              | Yes             |
| Multi-instance           | Yes             |
| Subscriptions            | Yes             |
| Distributed locking      | Yes (atomic)    |
| Key-value caching         | Yes (with TTL)  |
| Ordered lists            | Yes (with TTL)  |
| Per-thread FIFO queues   | Yes (with TTL)  |
| Automatic table creation | Yes             |
| Key prefix namespacing   | Yes             |

## Locking considerations

`acquireLock()` uses a single atomic `INSERT ... ON CONFLICT(key_prefix, thread_id) DO UPDATE ... WHERE expires_at <= ? RETURNING ...`. The conditional update only fires when the existing lock has expired, so an expired lock can be stolen atomically while a live lock blocks the acquisition (the statement returns no row, and the adapter returns `null`).

## Expired row cleanup

D1 has no native TTL expiry, so the adapter performs lazy, opportunistic cleanup:

- Expired locks are overwritten on the next `acquireLock()` for that thread.
- Expired cache entries are filtered on read and dropped on the next `setIfNotExists()` for that key.
- Expired list entries are purged on the next `getList()` / `appendToList()` for that key.
- Expired queue entries are purged on the next `enqueue()` / `dequeue()` for that thread, and excluded from `queueDepth()`.

There is no background sweep; rows expire as they are touched.

## License

MIT
