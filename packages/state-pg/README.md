# @chat-adapter/state-pg

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-pg)](https://www.npmjs.com/package/@chat-adapter/state-pg)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-pg)](https://www.npmjs.com/package/@chat-adapter/state-pg)

Production PostgreSQL state adapter for [Chat SDK](https://chat-sdk.dev) built with [pg](https://www.npmjs.com/package/pg) (node-postgres). Use this when PostgreSQL is your primary datastore and you want state persistence without a separate Redis dependency.

## Installation

```bash
pnpm add @chat-adapter/state-pg
```

## Usage

`createPostgresState()` auto-detects `POSTGRES_URL` (or `DATABASE_URL`) so you can call it with no arguments:

```typescript
import { Chat } from "chat";
import { createPostgresState } from "@chat-adapter/state-pg";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createPostgresState(),
});
```

To provide a URL explicitly:

```typescript
const state = createPostgresState({
  url: "postgres://postgres:postgres@localhost:5432/chat",
});
```

### Using an existing client

```typescript
import pg from "pg";

const client = new pg.Pool({ connectionString: process.env.POSTGRES_URL! });
const state = createPostgresState({ client });
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `url` | No* | Postgres connection URL |
| `client` | No | Existing `pg.Pool` instance |
| `keyPrefix` | No | Prefix for all state rows (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info").child("postgres")`) |

*Either `url`, `POSTGRES_URL`/`DATABASE_URL`, or `client` is required.

## Environment variables

```bash
POSTGRES_URL=postgres://postgres:postgres@localhost:5432/chat
```

## Data model

The adapter creates these tables automatically on `connect()`:

```sql
chat_state_subscriptions
chat_state_locks
chat_state_cache
```

All rows are namespaced by `key_prefix`.

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Multi-instance | Yes |
| Subscriptions | Yes |
| Distributed locking | Yes |
| Key-value caching | Yes (with TTL) |
| Automatic table creation | Yes |
| Key prefix namespacing | Yes |

## Locking considerations

The Redis state adapters use atomic `SET NX PX` for lock acquisition, which is a single atomic operation. The PostgreSQL adapter uses `INSERT ... ON CONFLICT DO UPDATE WHERE expires_at <= now()`, which relies on Postgres row-level locking. This is safe for most workloads but under extreme contention (many processes competing for the same lock simultaneously) may behave slightly differently than Redis. For high-contention distributed locking, prefer the Redis adapter.

## Expired row cleanup

Unlike Redis (which handles TTL expiry natively), PostgreSQL does not automatically delete expired rows. The adapter performs opportunistic cleanup — expired locks are overwritten on the next `acquireLock()` call, and expired cache entries are deleted on the next `get()` call for that key.

For high-throughput deployments, you may want to run a periodic cleanup job:

```sql
DELETE FROM chat_state_locks WHERE expires_at <= now();
DELETE FROM chat_state_cache WHERE expires_at <= now();
```

## License

MIT
