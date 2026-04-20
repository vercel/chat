# @chat-adapter/state-libsql

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-libsql)](https://www.npmjs.com/package/@chat-adapter/state-libsql)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-libsql)](https://www.npmjs.com/package/@chat-adapter/state-libsql)

libSQL / Turso state adapter for [Chat SDK](https://chat-sdk.dev) built with [@libsql/client](https://www.npmjs.com/package/@libsql/client). Works against a local SQLite file for development or a remote libSQL / Turso server in production — same API, just change the URL.

## Installation

```bash
pnpm add @chat-adapter/state-libsql @libsql/client
```

## Usage

`createLibSqlState()` auto-detects `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` so you can call it with no arguments:

```typescript
import { Chat } from "chat";
import { createLibSqlState } from "@chat-adapter/state-libsql";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createLibSqlState(),
});
```

### Local file (development)

```typescript
const state = createLibSqlState({
  url: "file:./chat-state.db",
});
```

### Remote libSQL / Turso

```typescript
const state = createLibSqlState({
  url: "libsql://your-db.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### Using an existing client

```typescript
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const state = createLibSqlState({ client });
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `url` | No* | libSQL connection URL (`file:`, `libsql:`, `http(s):`, `ws(s):`) |
| `authToken` | No | Auth token for remote libSQL / Turso |
| `config` | No | Additional `@libsql/client` options (`encryptionKey`, `syncUrl`, `intMode`, `tls`, …) |
| `client` | No | Existing libsql `Client` instance |
| `keyPrefix` | No | Prefix for all state rows (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info").child("libsql")`) |

*Either `url`, the `TURSO_DATABASE_URL` env var, or `client` is required.

## Environment variables

```bash
# Local file
TURSO_DATABASE_URL=file:./chat-state.db

# or remote libSQL / Turso
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
```

## Data model

The adapter creates these tables automatically on `connect()`:

```
chat_state_subscriptions
chat_state_locks
chat_state_cache
chat_state_lists
chat_state_queues
```

All rows are namespaced by `key_prefix`. Timestamps are stored as millisecond integers.

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Multi-instance | Yes (remote mode) |
| Subscriptions | Yes |
| Distributed locking | Yes |
| Key-value caching | Yes (with TTL) |
| Message queue | Yes |
| Ordered lists | Yes |
| Automatic table creation | Yes |
| Key prefix namespacing | Yes |

## Locking considerations

Lock acquisition runs inside a `transaction("write")` that clears any expired lock and then performs `INSERT ... ON CONFLICT DO NOTHING RETURNING`. This gives atomic compare-and-set semantics against both local SQLite files and remote libSQL / Turso servers.

For multi-instance deployments, use a remote libSQL / Turso URL — a local `file:` database only coordinates processes on the same host.

## Expired row cleanup

SQLite does not expire rows automatically. The adapter performs opportunistic cleanup on every relevant operation (`get`, `getList`, `dequeue`, lock acquisition). For long-running deployments you may want to run a periodic cleanup:

```sql
DELETE FROM chat_state_locks WHERE expires_at <= strftime('%s','now') * 1000;
DELETE FROM chat_state_cache WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s','now') * 1000;
DELETE FROM chat_state_queues WHERE expires_at <= strftime('%s','now') * 1000;
DELETE FROM chat_state_lists WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s','now') * 1000;
```

## License

MIT
