# @chat-adapter/state-supabase

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-supabase)](https://www.npmjs.com/package/@chat-adapter/state-supabase)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-supabase)](https://www.npmjs.com/package/@chat-adapter/state-supabase)

Production Supabase state adapter for [Chat SDK](https://chat-sdk.dev). It keeps Chat SDK state inside Postgres via Supabase RPCs, so you get durable subscriptions, distributed locks, cache TTLs, and list storage without adding Redis.

This package is intended for server-side usage. In most production deployments you should pass a service-role Supabase client.

## Installation

```bash
pnpm add @chat-adapter/state-supabase
```

## Quick start

1. Copy `sql/chat_state.sql` into your declarative schema folder.
2. Add `chat_state` to your Supabase API exposed schemas.
3. Create a server-side Supabase client and pass it to `createSupabaseState()`.

```typescript
import { createClient } from "@supabase/supabase-js";
import { Chat } from "chat";
import { createSupabaseState } from "@chat-adapter/state-supabase";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createSupabaseState({ client: supabase }),
});
```

## Usage examples

### Using an existing server-side helper

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseState } from "@chat-adapter/state-supabase";

const state = createSupabaseState({
  client: createAdminClient(),
});
```

### Custom schema and key prefix

```typescript
const state = createSupabaseState({
  client: supabase,
  schema: "bot_state",
  keyPrefix: "app-name-prod",
});
```

If you change the schema, replace `chat_state` throughout the provided SQL file and expose that schema in Supabase.

### Triggering cleanup from application code

```typescript
await supabase
  .schema("chat_state")
  .rpc("chat_state_cleanup_expired", { p_key_prefix: "app-name-prod" });
```

### Copying the migration into a declarative schema repo

```bash
cp node_modules/@chat-adapter/state-supabase/sql/chat_state.sql \
  supabase/schemas/11_chat_state.sql
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `client` | Yes | Existing `SupabaseClient` instance |
| `schema` | No | Schema containing the RPC functions (default: `"chat_state"`) |
| `keyPrefix` | No | Prefix for all state rows (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info").child("supabase")`) |

## Migration file

The package ships a copy-paste migration at `sql/chat_state.sql`.

It creates:

```sql
chat_state.chat_state_subscriptions
chat_state.chat_state_locks
chat_state.chat_state_cache
chat_state.chat_state_lists
```

and the RPC functions the adapter calls internally.

The migration intentionally:

- uses `jsonb` for cache and list values
- fixes the common expired-key bug in `setIfNotExists()` by allowing expired rows to be replaced atomically
- clears or refreshes list TTLs consistently across all rows in a list
- grants RPC execution only to `service_role` by default

## Why RPCs instead of direct table APIs?

Supabase table APIs are enough for some simple operations, but a production-grade state adapter still needs server-side atomicity for:

- lock acquisition with "take over only if expired" semantics
- `setIfNotExists()` that can replace expired keys
- list append + trim + TTL update in a single transaction

Using RPCs for all state operations keeps the permission model narrower, avoids exposing raw table writes as the primary API, and keeps behavior consistent across operations.

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Multi-instance | Yes |
| Subscriptions | Yes |
| Distributed locking | Yes |
| Key-value caching | Yes (with TTL) |
| List storage | Yes |
| Automatic schema creation | No |
| RPC-only API | Yes |
| Key prefix namespacing | Yes |

## Locking considerations

This adapter preserves Chat SDK's existing lock semantics. Lock acquisition is atomic in Postgres, but the higher-level behavior is still bounded by how Chat SDK uses locks. If your handlers can run longer than the configured lock TTL, increase the TTL or use Chat SDK's interruption/conflict patterns as appropriate.

For extremely high-contention distributed locking, a dedicated Redis-based adapter may still be a better fit.

## Cleanup behavior

The adapter does opportunistic cleanup during normal reads and writes:

- expired locks can be replaced during `acquireLock()`
- expired cache rows are deleted during `get()`
- expired list rows are deleted during `appendToList()` and `getList()`

For high-throughput deployments, run periodic cleanup as well:

```sql
select chat_state.chat_state_cleanup_expired();
```

or, for a single namespace:

```sql
select chat_state.chat_state_cleanup_expired('app-name-prod');
```

## Security notes

- Prefer a service-role client for server-side bots and background workers.
- Do not use this adapter from browser clients.
- The migration revokes direct table access and exposes RPC execution only to `service_role` by default.
- If you intentionally loosen those grants, do so with a clear threat model.

## License

MIT
