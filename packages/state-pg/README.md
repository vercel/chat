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
| `autoCreateSchema` | No | Create tables and indexes on connect (default: `true`); set to `false` for migrations |
| `keyPrefix` | No | Prefix for all state rows (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info").child("postgres")`) |

*Either `url`, `POSTGRES_URL`/`DATABASE_URL`, or `client` is required.

## Environment variables

```bash
POSTGRES_URL=postgres://postgres:postgres@localhost:5432/chat
```

## Data model

By default, the adapter creates these tables and their indexes on `connect()`:

```sql
chat_state_subscriptions
chat_state_locks
chat_state_cache
chat_state_lists
chat_state_queues
```

All rows are namespaced by `key_prefix`.

### Migration-owned schema

Set `autoCreateSchema: false` when your migrations provision the tables and indexes. The default is `true`.

```typescript
// Explicit URL, or omit url to use POSTGRES_URL / DATABASE_URL.
const state = createPostgresState({
  url: process.env.POSTGRES_URL,
  autoCreateSchema: false,
});
```

An existing pool supports the same option. The adapter has no `schemaName` option: every query uses unqualified table names that resolve through the connection's PostgreSQL `search_path`. To keep the tables in a dedicated schema, set the runtime role's default `search_path`. A role default follows the role through connection poolers such as PgBouncer, Neon, and Supabase in transaction mode, which may reject or silently drop per-connection startup parameters.

```sql
ALTER ROLE chat_runtime SET search_path TO chat_state;
```

On a direct connection you can set it per connection instead, either with `options` on the pool or with `?options=-c%20search_path%3Dchat_state` on the connection URL.

```typescript
import pg from "pg";
import { createPostgresState } from "@chat-adapter/state-pg";

const client = new pg.Pool({
  connectionString: process.env.POSTGRES_URL,
  options: "-c search_path=chat_state",
});
const state = createPostgresState({ client, autoCreateSchema: false });
```

Before starting the bot, run the adapter migration as the schema owner, using the same `search_path` as the runtime connection. Create your chosen schema first if needed. The adapter exports the complete migration as `postgresSchemaStatements`, an ordered array of statements you can run from your own migration tooling:

```typescript
import { postgresSchemaStatements } from "@chat-adapter/state-pg";

for (const statement of postgresSchemaStatements) {
  await client.query(statement);
}
```

If you would rather keep the migration in SQL, these are the same statements. They make up the complete adapter schema; `bigserial` also creates the list and queue sequences.

```sql
CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
  key_prefix text NOT NULL,
  thread_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_prefix, thread_id)
);

CREATE TABLE IF NOT EXISTS chat_state_locks (
  key_prefix text NOT NULL,
  thread_id text NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_prefix, thread_id)
);

CREATE TABLE IF NOT EXISTS chat_state_cache (
  key_prefix text NOT NULL,
  cache_key text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_prefix, cache_key)
);

CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
  ON chat_state_locks (expires_at);

CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
  ON chat_state_cache (expires_at);

CREATE TABLE IF NOT EXISTS chat_state_lists (
  key_prefix text NOT NULL,
  list_key text NOT NULL,
  seq bigserial NOT NULL,
  value text NOT NULL,
  expires_at timestamptz,
  PRIMARY KEY (key_prefix, list_key, seq)
);

CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx
  ON chat_state_lists (expires_at);

CREATE TABLE IF NOT EXISTS chat_state_queues (
  key_prefix text NOT NULL,
  thread_id text NOT NULL,
  seq bigserial NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_prefix, thread_id, seq)
);

CREATE INDEX IF NOT EXISTS chat_state_queues_expires_idx
  ON chat_state_queues (expires_at);
```

Grant the runtime role access to the schema, all five tables, and both sequences. For example, after creating the objects in a dedicated `chat_state` schema with a separate owner:

```sql
GRANT USAGE ON SCHEMA chat_state TO chat_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA chat_state TO chat_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA chat_state TO chat_runtime;
```

The runtime role also needs database `CONNECT` permission. It does not need schema `CREATE` permission or table ownership. Adjust the schema and role names to your deployment; these grants apply to existing objects only.

With this option disabled, `connect()` checks connectivity with `SELECT 1` and then runs one read-only query to verify that all five tables exist and that the current role holds the privileges the adapter uses on each of them: `SELECT`, `INSERT`, and `DELETE` everywhere, `UPDATE` on the locks, cache, and lists tables, and `nextval` on the list and queue sequences through either `USAGE` or `UPDATE`. Identity `seq` columns need no sequence grant. It never issues DDL. If anything is missing, `connect()` rejects with an error naming the problem, so a wrong `search_path` or a forgotten grant fails at startup instead of on the first message. Your application owns migrations for future adapter schema changes too; the changelog for `@chat-adapter/state-pg` lists the statements to run when the schema changes. An externally supplied pool remains open after `disconnect()`.

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
