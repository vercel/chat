# @chat-adapter/state-libsql

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-libsql)](https://www.npmjs.com/package/@chat-adapter/state-libsql)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-libsql)](https://www.npmjs.com/package/@chat-adapter/state-libsql)

libSQL / Turso state adapter for [Chat SDK](https://chat-sdk.dev). Ships two variants — import the one that matches your runtime. 

| Import path | Driver | Best for |
|---|---|---|
| `@chat-adapter/state-libsql` | [`libsql`](https://www.npmjs.com/package/libsql) (native binding) | Node. Fast local file access, also supports remote libSQL / Turso. |
| `@chat-adapter/state-libsql/client` | [`@libsql/client`](https://www.npmjs.com/package/@libsql/client) (pure JS) | Edge / serverless (Vercel) where native modules aren't available. |

Both entry points expose the same chat-sdk `StateAdapter` surface with `createLibSqlState` and `LibSqlStateAdapter`.

## Installation

Install the package plus **one** of the two drivers:

```bash
# Node / local-file primary
pnpm add @chat-adapter/state-libsql libsql

# edge / Turso-primary
pnpm add @chat-adapter/state-libsql @libsql/client
```

Both drivers are declared `optional` peer dependencies — pnpm / npm won't complain if you only install one.

## Usage

### Node + local file

```typescript
import { Chat } from "chat";
import { createLibSqlState } from "@chat-adapter/state-libsql";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createLibSqlState({ url: "file:./chat-state.db" }),
});
```

### Edge / serverless + Turso

```typescript
import { createLibSqlState } from "@chat-adapter/state-libsql/client";

const state = createLibSqlState({
  url: "libsql://your-db.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### Auto-detect via env vars

Both variants read `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` if no options are provided:

```typescript
const state = createLibSqlState(); // uses TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
```

### Injecting your own client

Native:

```typescript
import Database from "libsql/promise";
import { createLibSqlState } from "@chat-adapter/state-libsql";

const db = new Database("file:./chat-state.db", {});
const state = createLibSqlState({ client: db });
```

`@libsql/client`:

```typescript
import { createClient } from "@libsql/client";
import { createLibSqlState } from "@chat-adapter/state-libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const state = createLibSqlState({ client });
```

## Configuration

Both entry points accept the same core options:

| Option | Required | Description |
|--------|----------|-------------|
| `url` | No* | libSQL connection URL / path |
| `authToken` | No | Auth token for remote libSQL / Turso |
| `client` | No | Existing driver client instance |
| `keyPrefix` | No | Prefix for all state rows (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info").child("libsql")`) |

*Either `url`, the `TURSO_DATABASE_URL` env var, or `client` is required.

The default entry additionally accepts `syncUrl`, `syncPeriod`, `encryptionKey`, `offline`, `timeout`.
The `/client` entry additionally accepts a `config` pass-through for `@libsql/client` (`encryptionKey`, `syncUrl`, `intMode`, `tls`, …).

### URL schemes

| Scheme | Default (`libsql`) | `/client` (`@libsql/client`) |
|--------|:------------------:|:----------------------------:|
| `file:...` | ✅ | ✅ |
| `:memory:` | ✅ | — |
| `libsql:...` | ✅ | ✅ |
| `http(s)://...` | ✅ | ✅ |
| `ws(s)://...` | — | ✅ |

Always prefix local paths with `file:` — both drivers accept it, and it keeps your config portable if you later switch entry points.

## Environment variables

```bash
# Local file (works with both entries)
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

Lock acquisition runs inside a write transaction that clears any expired lock and then performs `INSERT ... ON CONFLICT DO NOTHING RETURNING`. This gives atomic compare-and-set semantics against both local SQLite files and remote libSQL / Turso servers.

For multi-instance deployments, use a remote libSQL / Turso URL — a local file database only coordinates processes on the same host.

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
