# @chat-adapter/state-pg

> npm package: [`@chat-adapter/state-pg`](https://www.npmjs.com/package/@chat-adapter/state-pg)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Production PostgreSQL state adapter for [Chat SDK](https://chat-sdk.dev) built with [pg](https://www.npmjs.com/package/pg) (node-postgres). Use this when PostgreSQL is your primary datastore and you want state persistence without a separate Redis dependency.

Documentation: [chat-sdk.dev/adapters/official/postgres](https://chat-sdk.dev/adapters/official/postgres) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/state-pg
```

## Scaffold with the CLI

To scaffold a new Slack bot that uses PostgreSQL for state:

```bash
npx create-chat-sdk@latest my-bot --adapter slack postgres
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

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
chat_state_lists
chat_state_queues
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

Unlike Redis (which handles TTL expiry natively), PostgreSQL does not automatically delete expired rows. The adapter performs opportunistic cleanup — expired locks are overwritten on the next `acquireLock()` call, expired cache entries are deleted on the next `get()` call for that key, and expired queue entries for a given thread are purged on the next `enqueue()` or `dequeue()` call. Expired list entries are filtered out on read but never deleted by the adapter.

For high-throughput deployments, you may want to run a periodic cleanup job:

```sql
DELETE FROM chat_state_locks WHERE expires_at <= now();
DELETE FROM chat_state_cache WHERE expires_at <= now();
DELETE FROM chat_state_lists WHERE expires_at <= now();
DELETE FROM chat_state_queues WHERE expires_at <= now();
```

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit — it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
