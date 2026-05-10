# AGENTS.md — `@chat-adapter/web`

Guidance for coding agents working inside the Web adapter package.
The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/web` lets a Chat SDK bot serve a browser chat UI
alongside Slack, Teams, Discord, and the rest. The same handlers fire
for every platform — the Web adapter just speaks the
`@ai-sdk/react` `useChat` UI message stream protocol so a `<Chat>`
React component can drop in next to the bot's existing webhooks.

What it covers:

- HTTP endpoint at `/api/chat` (or wherever the adapter is mounted).
  Handles POST requests carrying the `useChat` request body and
  responds with an SSE UI message stream.
- Native streaming via the SSE protocol — no edit loop, no rate
  limiting, abort propagation through `request.signal` to the
  handler.
- DM-style routing — every browser session is treated as a DM thread
  scoped to the resolved user.
- Optional persisted message history through the configured state
  adapter (so handlers can use `thread.messages` across requests).
- Thin React wrapper at `@chat-adapter/web/react` that preconfigures
  `@ai-sdk/react`'s `useChat` with a `DefaultChatTransport`.

## Directory layout

```
packages/adapter-web/
├── src/
│   ├── index.ts             # createWebAdapter factory + public types
│   ├── adapter.ts           # WebAdapter class implementation
│   ├── als.ts               # AsyncLocalStorage scope for the active request
│   ├── format-converter.ts  # WebFormatConverter (mdast ↔ markdown)
│   ├── index.test.ts
│   ├── types.ts             # WebUser, request shape, postable types
│   └── react/
│       └── index.ts         # useChat wrapper for the React entry point
├── package.json
├── tsconfig.json
├── tsup.config.ts           # builds two entry points (server + react)
├── vitest.config.ts
└── README.md
```

The `react/` subentry is published as `@chat-adapter/web/react`. Keep
the server entry free of any React imports — only `react/index.ts`
should reference `@ai-sdk/react`.

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/web build
pnpm --filter @chat-adapter/web test
```

Tests are pure unit tests — there are no replay fixtures because the
Web adapter has no platform side. Integration coverage comes via
`examples/nextjs-chat`.

## Public surface

Server entry (`@chat-adapter/web` → `src/index.ts`):

- `createWebAdapter(config)` — primary factory. Required:
  `userName` (bot name) and `getUser(request)` resolver. Optional:
  `persistMessageHistory`, `threadIdFor`, `logger`.
- `WebAdapter` class — implements `Adapter<WebThreadId, unknown>`.
  Public methods: `handleWebhook` (mounted at `/api/chat` etc.),
  `postMessage`, `editMessage`, `deleteMessage`, `addReaction`,
  `removeReaction`, `startTyping`, `fetchThread`, `fetchMessages`,
  `fetchSingleMessage`, `openDM`.
- Configuration: `WebAdapterConfig`, `WebUser`, `WebThreadId`.
- `encodeThreadId`, `decodeThreadId`, `isDM`.

React entry (`@chat-adapter/web/react` → `src/react/index.ts`):

- `useChat(options)` — wraps `@ai-sdk/react`'s `useChat` with a
  `DefaultChatTransport` preconfigured to talk to the Web adapter
  endpoint.

## Thread ID format

```
web:{user.id}:{conversationId}
```

`user.id` comes from `getUser(request)`. `conversationId` is the
`id` field useChat sends in its request body — when the client
supplies one (`useChat({ id: "support-chat" })`), it persists across
reloads; otherwise a fresh id is generated per request.

`threadIdFor` overrides the default if you want a different scheme
(e.g. one thread per user). Ids returned by `getUser` that contain
`:` are rejected with HTTP 400 — normalize them inside `getUser`
(base64-encode if your auth provider emits `provider:sub`-style ids).

`isDM(threadId)` always returns `true` — the Web adapter has no
group concept.

## Webhook flow

The adapter's `handleWebhook(request, options)` is mounted at the
chat route (typically `/api/chat`). It:

1. Calls `getUser(request)`. Returning `null` produces HTTP 401.
2. Decodes the `useChat` request body to extract `id`, `messages[]`,
   and any client-supplied metadata.
3. Resolves the thread id via `threadIdFor` (default
   `web:{user.id}:{conversationId}`).
4. Persists the inbound `messages[]` into the configured state
   adapter when `persistMessageHistory: true`.
5. Routes to `chat.handleIncomingMessage`.
6. Streams the handler's `thread.post` output back to the browser as
   SSE chunks following the AI message stream protocol.

`request.signal` is plumbed through `als.ts` so calling `stop()` from
the React side aborts the handler's iterator.

## Authentication

`getUser` is the **security boundary**. Every request comes from a
browser with no Slack-style platform signature, so the adapter
delegates the identity check to the user-supplied function.

Patterns to support:

- NextAuth — `getServerSession(authOptions)`.
- Clerk — `auth()` + `sessionClaims`.
- Custom JWT — verify the bearer token in `Authorization`.
- Cookies — read a session cookie and look it up against your
  store.

Returning `null` produces 401; returning a `WebUser` with `id` set
unlocks the rest of the request lifecycle.

## Streaming

`thread.post` accepts an `AsyncIterable<string | StreamChunk>` and
pumps deltas straight onto the SSE response. There's no edit loop
and no rate limiting because the protocol is duplex by design — the
browser is the only consumer.

This pairs neatly with `streamText` from the AI SDK:

```typescript
import { streamText } from "ai";

bot.onDirectMessage(async (thread, message) => {
  const result = streamText({ model, prompt: message.text });
  await thread.post(result.textStream);
});
```

The adapter honours `request.signal`, so the iterator is short-
circuited as soon as the browser disconnects.

## Format conversion

`WebFormatConverter` (in `format-converter.ts`) maps mdast to plain
markdown — the browser renderer (typically `streamdown` or
`react-markdown`) handles the actual rendering.

- mdast → markdown — straightforward; emits CommonMark plus GFM
  extensions (tables, strikethrough, task lists).
- markdown → mdast — relies on `mdast-util-from-markdown` from the
  core `chat` package.

`renderPostable` is identical to the markdown emitter for this
adapter — there's no platform-specific rewriting.

## Persistence

`persistMessageHistory` defaults to `true`. The Web adapter has no
platform-side history API, so the only way for handlers to see prior
turns via `thread.messages` is through the state adapter's cache.
Set it to `false` only if your handler re-derives history from the
request body's `messages[]` (e.g. by trusting the client snapshot).

## React hook

`@chat-adapter/web/react`'s `useChat` is a thin wrapper around
`@ai-sdk/react`'s hook of the same name:

```tsx
import { useChat } from "@chat-adapter/web/react";

const { messages, sendMessage, status, stop, regenerate } = useChat({
  api: "/api/chat",
  threadId: "support-1",
});
```

Options:

- `api` — endpoint path (default `/api/chat`).
- `threadId` — Chat SDK thread id surfaced as the request body's
  `id`. Strongly recommended.
- `experimental_throttle` — throttle wait in ms.
- `resume` — resume an in-flight stream.
- `...rest` — passes through to `@ai-sdk/react`'s `useChat`.

For advanced configuration, use `@ai-sdk/react`'s `useChat` directly;
there's nothing magical in the wrapper.

## Web quirks worth remembering

- **No platform side.** Many adapter behaviours (reactions, edit /
  delete, file uploads, modals) are no-ops because the browser
  renderer doesn't need them. The contract methods exist but throw
  `NotImplementedError` for the unsupported ones.
- **Aborts on unmount.** When the user navigates away, the browser
  closes the SSE connection. The adapter forwards that as
  `request.signal.abort()`; handlers must stop work promptly.
- **Per-request `AsyncLocalStorage`** scope is provided by `als.ts`.
  Use it instead of mutable adapter state for anything request-
  scoped.
- **No webhook signature**, no platform secret. `getUser` is
  everything.
- **Text-only formatting.** Cards, modals, and reactions are not
  exposed in the v1 protocol — the browser handles all rich UI
  itself via `ai-elements` or custom React.

## Testing approach

- **Unit tests** in `index.test.ts` exercise the request decoder,
  thread-id derivation, persistence path, and SSE output.
- The integration story is the `examples/nextjs-chat` app — run it
  locally to validate manual flows.

## Coding conventions

- Use named exports throughout. No default exports.
- Keep server code free of React imports. The bundler emits two
  entry points; only `src/react/index.ts` may import from
  `@ai-sdk/react`.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `ValidationError`). The Web adapter has no rate-limit or network
  errors of its own.
- Top-level regex literals only.
- Avoid mutable adapter state — use `AsyncLocalStorage` via
  `als.ts` for request-scoped values.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/web` plus `chat` if a public type changed). React
hook changes belong in the same package since they share the
version with the server entry.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/web.mdx`](../../apps/docs/content/adapters/official/web.mdx)
- README: [`packages/adapter-web/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Example app: [`examples/nextjs-chat`](../../examples/nextjs-chat)
