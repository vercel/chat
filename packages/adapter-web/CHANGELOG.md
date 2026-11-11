# @chat-adapter/web

## 4.44.0

### Patch Changes

- d3dc15a: `parseIncoming()` now skips markdown parsing for more kinds of input that are slow to parse, not just long text. Some messages under the 16,384-character limit took seconds to parse, threw a stack overflow, or produced trees too deep to serialize. Examples include unmatched `*`, `_`, or `~` in one paragraph, runs of `]` or `<`, `www.` repeated within one word, and lines that open hundreds of nested quotes or lists. Before parsing, `parseIncoming()` now also checks for more than 2,048 `*`, `_`, and `~` characters (`maxIncomingEmphasisMarkers`), more than 128 `]` characters (`maxIncomingClosingBrackets`), more than 512 `<` characters (`maxIncomingAngleBrackets`), more than 8 `www.` links in one word (`maxIncomingWwwAutolinks`), and lines nested more than 32 deep (`maxIncomingContainerMarkers`). These checks run in linear time and ignore characters inside fenced code blocks. After parsing, it checks for trees deeper than 128 levels (`maxIncomingAstDepth`), and it also falls back when `toAst()` throws a `RangeError`. When any limit is hit, the text is kept verbatim in a single text node. Converters can override `incomingFallbackText()` to clean up that text, and `exceedsIncomingBudget()` to check text they rewrite before parsing.
  
  The Discord gateway, Instagram, Linear, Messenger, Notion, Slack, Teams history, Telegram, Twilio, Web, WhatsApp, and XChat adapters now build incoming and fetched messages with `parseIncoming()` instead of parsing them without limits, and so does GitHub `listThreads` for pull request titles. These adapters didn't limit inbound length before, so messages over 16,384 characters now also lose markdown structure in `formatted`, while keeping their content in `text`. Deeply nested quotes no longer make these adapters drop the message, return a server error, or fail a whole page of history.
  
  Slack checks the limits once across a message's text, blocks, attachments, and table cells, checks the markdown it converts mrkdwn into, and on fallback decodes entities and renders mentions, channels, and links as parsed messages do. Discord, Google Chat, and WhatsApp check the markdown they convert platform text into. Teams checks the limits on decoded text, renders mentions and entities as plain text on fallback, and no longer backtracks for seconds on malformed links in incoming HTML.
- Updated dependencies [b8b6f0f]
- Updated dependencies [49e6833]
- Updated dependencies [d3dc15a]
- Updated dependencies [6c4457e]
- Updated dependencies [17f6005]
  - chat@4.44.0
  - @chat-adapter/shared@4.44.0

## 4.43.0

### Minor Changes

- 2e7e0ef: The Web adapter's server entry no longer depends on the AI SDK at runtime, and a new `protocol` option lets it speak AG-UI (`protocol: "ag-ui"`) for TanStack AI and other AG-UI clients. The default stays `"ai-sdk"`. `ai` is now an optional peer dependency, needed only for the `react`, `vue`, and `svelte` helpers.
  
  `message.raw` is now typed as the new `WebMessage` type instead of the AI SDK `UIMessage`. A `UIMessage` is still assignable to `WebMessage`, but part fields other than `type` are typed `unknown`. If your handler reads typed part fields with the `"ai-sdk"` protocol, cast with `message.raw as UIMessage`.
  
  Request handling is stricter and handles retries:
  
  - The last entry in `messages` must be a user message. Bodies ending in an assistant or tool message, such as client-side tool results, now get a 400 instead of being silently ignored.
  - A conversation id (`id` with `"ai-sdk"`, `threadId` with `"ag-ui"`) that is present but not a string gets a 400 instead of a new conversation.
  - Resending the same user message, as regenerate in `useChat` or reload in TanStack AI does, now runs the handler again instead of being dropped as a duplicate. History keeps the earlier reply and stores the repeated message a second time.
  - A body shaped for the other protocol gets a 400 that names the `protocol` option.

### Patch Changes

- Updated dependencies [115cd39]
- Updated dependencies [36325f3]
- Updated dependencies [a32470e]
- Updated dependencies [228b30d]
  - chat@4.43.0
  - @chat-adapter/shared@4.43.0

## 4.42.0

### Patch Changes

- Updated dependencies [2f1cfa2]
- Updated dependencies [daaa0ac]
- Updated dependencies [fd291b8]
- Updated dependencies [19c7aa2]
- Updated dependencies [08081fa]
- Updated dependencies [19c7aa2]
- Updated dependencies [80e7bae]
- Updated dependencies [08081fa]
- Updated dependencies [7b7d73c]
- Updated dependencies [f8527b2]
- Updated dependencies [9a83b22]
- Updated dependencies [8178fdb]
- Updated dependencies [f635dbe]
  - chat@4.42.0
  - @chat-adapter/shared@4.42.0

## 4.41.1

### Patch Changes

- Updated dependencies [6f17495]
  - chat@4.41.1
  - @chat-adapter/shared@4.41.1

## 4.41.0

### Patch Changes

- Updated dependencies [f233ffe]
- Updated dependencies [6adca36]
- Updated dependencies [ad90432]
- Updated dependencies [683eadc]
- Updated dependencies [dc2a777]
- Updated dependencies [139d337]
- Updated dependencies [2e2426d]
- Updated dependencies [8421953]
- Updated dependencies [91683e5]
- Updated dependencies [056d883]
- Updated dependencies [c21ccbc]
- Updated dependencies [fcdc1c9]
  - chat@4.41.0
  - @chat-adapter/shared@4.41.0

## 4.40.0

### Patch Changes

- Updated dependencies [f485255]
- Updated dependencies [b7c9316]
- Updated dependencies [4a0b5c0]
  - chat@4.40.0
  - @chat-adapter/shared@4.40.0

## 4.39.0

### Patch Changes

- 500b7e6: enforce the conversation scope on write tools and stop trusting client-supplied message history in the web adapter

  `createChatTools` now runs the same scope guard on write tools that read tools already used, so a thread or channel id the model supplies that resolves outside the scoped conversation is rejected before the write executes. `sendDirectMessage` targets a user id rather than a conversation and stays gated by approval alone.

  The web adapter no longer treats the request body's `messages` array as a source of conversation state. Only the latest user message is consumed, and tool parts are stripped from it so a browser cannot inject forged tool-call or approval state. Text, file, and custom data parts pass through unchanged; a message left with no parts after stripping is rejected with HTTP 400. Prior turns come from the state adapter when `persistMessageHistory` is enabled.

- Updated dependencies [2ce2be0]
- Updated dependencies [153bd96]
- Updated dependencies [16ea171]
- Updated dependencies [169788b]
- Updated dependencies [eddcd7e]
- Updated dependencies [bb92688]
- Updated dependencies [5b538f6]
- Updated dependencies [e71bfea]
- Updated dependencies [929878b]
- Updated dependencies [500b7e6]
- Updated dependencies [b6fa24c]
  - chat@4.39.0
  - @chat-adapter/shared@4.39.0

## 4.38.1

### Patch Changes

- Updated dependencies [6cb933e]
- Updated dependencies [764e475]
  - chat@4.38.1
  - @chat-adapter/shared@4.38.1

## 4.38.0

### Patch Changes

- Updated dependencies [0f24cc3]
- Updated dependencies [bdeb2bf]
- Updated dependencies [a0cba02]
- Updated dependencies [83ede7e]
- Updated dependencies [18d4a23]
  - chat@4.38.0
  - @chat-adapter/shared@4.38.0

## 4.37.0

### Patch Changes

- Updated dependencies [2a2b2c5]
- Updated dependencies [4ac0455]
- Updated dependencies [0ec6a73]
- Updated dependencies [85e3d22]
  - chat@4.37.0
  - @chat-adapter/shared@4.37.0

## 4.36.0

### Patch Changes

- Updated dependencies [257a32d]
- Updated dependencies [c5d86b1]
- Updated dependencies [0153a39]
- Updated dependencies [b547f45]
- Updated dependencies [caa6325]
  - chat@4.36.0
  - @chat-adapter/shared@4.36.0

## 4.35.0

### Patch Changes

- Updated dependencies [80def3a]
- Updated dependencies [4cb7e5d]
- Updated dependencies [46681f5]
- Updated dependencies [93a58af]
- Updated dependencies [25f3099]
  - chat@4.35.0
  - @chat-adapter/shared@4.35.0

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
