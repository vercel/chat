# @chat-adapter/web

## 4.34.0

### Minor Changes

- 6714efc: Support AI SDK v7 as a peer dependency.

  - `chat` now accepts `ai@^6.0.182 || ^7.0.0` (`chat/ai` tools work with both majors).
  - `@chat-adapter/web` now accepts `ai@^6 || ^7`, `@ai-sdk/react@^3 || ^4`, `@ai-sdk/svelte@^4 || ^5`, and `@ai-sdk/vue@^3 || ^4`.
  - The `chat/ai` tool factories now declare explicit `Tool<Input, Output>` return types instead of relying on inference, so the published declarations no longer depend on `ai` internals that changed in v7. The public type surface is unchanged.

### Patch Changes

- Updated dependencies [5c926f1]
- Updated dependencies [2531a42]
- Updated dependencies [1721fa0]
- Updated dependencies [4717a38]
- Updated dependencies [6714efc]
  - chat@4.34.0
  - @chat-adapter/shared@4.34.0

## 4.33.0

### Patch Changes

- Updated dependencies [3abdc69]
- Updated dependencies [0b63791]
- Updated dependencies [0c761f1]
- Updated dependencies [ef2542c]
- Updated dependencies [24a04d5]
- Updated dependencies [d4c52ca]
- Updated dependencies [076fe5d]
  - chat@4.33.0
  - @chat-adapter/shared@4.33.0

## 4.32.0

### Patch Changes

- Updated dependencies [eccc6b9]
- Updated dependencies [438f551]
- Updated dependencies [d034b8b]
- Updated dependencies [06af3e1]
- Updated dependencies [2e47351]
- Updated dependencies [efa9610]
  - chat@4.32.0
  - @chat-adapter/shared@4.32.0

## 4.31.0

### Patch Changes

- Updated dependencies [778ae69]
- Updated dependencies [171657a]
  - chat@4.31.0
  - @chat-adapter/shared@4.31.0

## 4.30.0

### Patch Changes

- 9b8d8c4: expand npm `keywords` for adapter and state packages to improve discoverability (adds `chat-sdk`, `chatbot`, `ai-agent`, `ai-sdk`, `vercel`, plus platform-specific terms)
- Updated dependencies [5461ea9]
  - chat@4.30.0
  - @chat-adapter/shared@4.30.0

## 4.29.0

### Minor Changes

- 2ffed48: Adapter internals are now `protected` rather than `private`, so consumers can subclass an adapter to override or extend its behavior (e.g. handling additional Telegram update types by overriding `processUpdate`).
- 716e934: Add first-class Vue and Svelte support via new subpath exports `@chat-adapter/web/vue` and `@chat-adapter/web/svelte`. Each exports a `useChat()` factory preconfigured with `DefaultChatTransport`, returning a framework-reactive `Chat` instance from `@ai-sdk/vue` / `@ai-sdk/svelte` respectively. Note: unlike the React subpath which wraps `@ai-sdk/react`'s `useChat` hook and returns destructurable helpers, the Vue and Svelte wrappers return a `Chat` class instance — access `chat.messages`, `chat.sendMessage()`, `chat.status`, and `chat.stop()` directly on the object.

### Patch Changes

- e60bc8c: chore: set supported Node versions in engines
- 06fb8e5: Align package shapes with the new `konsistent` conventions. All changes are
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

- Updated dependencies [ac8a207]
- Updated dependencies [e60bc8c]
- Updated dependencies [add2730]
- Updated dependencies [b75eedb]
  - chat@4.29.0
  - @chat-adapter/shared@4.29.0

## 4.28.1

### Patch Changes

- Updated dependencies [0cc3d06]
  - chat@4.28.1
  - @chat-adapter/shared@4.28.1

## 4.28.0

### Minor Changes

- 3490a8c: Add **`@chat-adapter/web`** — a new platform adapter that lets a chat-sdk bot serve a browser chat UI alongside Slack/Teams/Discord, without writing any client-side glue.

  The adapter speaks the [AI SDK UI message stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), so [`@ai-sdk/react`](https://www.npmjs.com/package/@ai-sdk/react)'s `useChat` and the [`ai-elements`](https://elements.ai-sdk.dev/) component library work out of the box. The same `bot.onDirectMessage(...)` handler fires for both web and other platforms — including stream-based replies via `thread.post(stream)`.

  Two subpath exports:

  - `@chat-adapter/web` — server-side `createWebAdapter({ userName, getUser })` that produces an `Adapter` for the `Chat` constructor.
  - `@chat-adapter/web/react` — thin client wrapper exposing `useChat()` preconfigured with `DefaultChatTransport`. Re-exports `UIMessage` and `UseChatHelpers` types.

  ```ts
  // server
  const bot = new Chat({
    userName: "mybot",
    adapters: {
      web: createWebAdapter({
        userName: "mybot",
        getUser: (req) => ({ id: getUserIdFromCookie(req) }),
      }),
    },
    state: createMemoryState(),
  });
  export const POST = bot.webhooks.web;
  ```

  ```tsx
  // client
  import { useChat } from "@chat-adapter/web/react";
  const { messages, sendMessage, status } = useChat();
  ```

  v1 covers text + markdown, native streaming, DM-style routing (`isDM: true`), persisted message history (`persistMessageHistory: true` by default — required for `channel.messages` since web has no platform history API), and abort propagation via `request.signal`. Out of scope for v1: cards/JSX rendering, reactions, modals, file uploads, edit/delete, and multi-tab proactive push.

### Patch Changes

- Updated dependencies [eb5f94a]
- Updated dependencies [c1cd9b5]
- Updated dependencies [9824d33]
- Updated dependencies [46d183b]
- Updated dependencies [46d183b]
- Updated dependencies [3490a8c]
  - chat@4.28.0
  - @chat-adapter/shared@4.28.0
