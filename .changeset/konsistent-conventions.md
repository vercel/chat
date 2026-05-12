---
"@chat-adapter/gchat": patch
"@chat-adapter/messenger": patch
"@chat-adapter/slack": patch
"@chat-adapter/state-ioredis": patch
"@chat-adapter/state-memory": patch
"@chat-adapter/state-pg": patch
"@chat-adapter/state-redis": patch
"@chat-adapter/web": patch
"@chat-adapter/whatsapp": patch
---

Align package shapes with the new `konsistent` conventions. All changes are
backwards-compatible — previous type names are kept as deprecated aliases.

- `@chat-adapter/gchat`, `@chat-adapter/slack`: moved `*AdapterConfig` (and
  related sub-types) into a `./types` module; the public re-exports from
  `index.ts` are unchanged.
- `@chat-adapter/slack`: `createSlackAdapter` now accepts `SlackAdapterConfig`
  directly instead of `Partial<SlackAdapterConfig>`. Every field on the config
  was already optional, so no call sites need to change.
- `@chat-adapter/messenger`: `MessengerAdapterConfig` fields are now optional
  (the factory still falls back to `FACEBOOK_*` env vars), and `logger` /
  `userName` live on `MessengerAdapterConfig` directly. The factory signature
  is now `createMessengerAdapter(config?: MessengerAdapterConfig)`.
- `@chat-adapter/web`: renamed `WebAdapterOptions` to `WebAdapterConfig`; the
  old name is exported as a deprecated alias.
- `@chat-adapter/whatsapp`: every field on `WhatsAppAdapterConfig` is optional
  (the factory still falls back to `WHATSAPP_*` env vars). `createWhatsAppAdapter`
  is now typed `(config?: WhatsAppAdapterConfig) => WhatsAppAdapter`.
- `@chat-adapter/state-memory`: added an empty `MemoryStateAdapterOptions`
  type so the package matches every other state adapter; `createMemoryState`
  now accepts an optional argument of that type.
- `@chat-adapter/state-ioredis`, `@chat-adapter/state-redis`,
  `@chat-adapter/state-pg`: the URL- and client-based option shapes were split
  into named interfaces (`*StateAdapterUrlOptions` /
  `*StateAdapterClientOptions`) and unified under `*StateAdapterOptions`. The
  factories now take the union type directly. Old names — `RedisStateClientOptions`,
  `CreateRedisStateOptions`, `PostgresStateClientOptions`,
  `CreatePostgresStateOptions`, `IoRedisStateClientOptions` — are kept as
  deprecated aliases.
