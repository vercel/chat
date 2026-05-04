# @chat-adapter/web

[![npm version](https://img.shields.io/npm/v/@chat-adapter/web)](https://www.npmjs.com/package/@chat-adapter/web)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/web)](https://www.npmjs.com/package/@chat-adapter/web)

Web adapter for [Chat SDK](https://chat-sdk.dev). Lets a chat-sdk bot serve a browser chat UI alongside Slack, Teams, Discord, etc. — the same `bot.onDirectMessage(...)` handler fires for every platform.

The adapter speaks the [AI SDK UI message stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), so [`@ai-sdk/react`](https://www.npmjs.com/package/@ai-sdk/react)'s `useChat` and the [`ai-elements`](https://elements.ai-sdk.dev/) component library work out of the box.

## Installation

```bash
pnpm add @chat-adapter/web ai @ai-sdk/react
```

## Quick start

### Server

```typescript
// lib/bot.ts
import { Chat } from "chat";
import { createWebAdapter } from "@chat-adapter/web";
import { createMemoryState } from "@chat-adapter/state-memory";

export const bot = new Chat({
  userName: "mybot",
  adapters: {
    web: createWebAdapter({
      userName: "mybot",
      getUser: (req) => ({ id: getUserIdFromCookie(req) }),
    }),
  },
  state: createMemoryState(),
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

```typescript
// app/api/chat/route.ts
import { after } from "next/server";
import { bot } from "@/lib/bot";

export async function POST(request: Request): Promise<Response> {
  return bot.webhooks.web(request, {
    waitUntil: (task) => after(() => task),
  });
}
```

### Client

```tsx
// app/chat/page.tsx
"use client";
import { useChat } from "@chat-adapter/web/react";

export default function ChatPage() {
  const { messages, sendMessage, status, stop } = useChat();
  // Render with `ai-elements` (<Conversation>, <Message>, <PromptInput>)
  // or your own components — `messages`, `sendMessage`, `status` are the
  // standard `@ai-sdk/react` API.
}
```

## Authentication

`getUser` is the **security boundary** for the Web adapter. Unlike Slack/Teams where the platform signs every webhook, web requests come straight from a browser — you must identify the caller yourself. Returning `null` causes the adapter to respond with HTTP 401 and no handler runs.

Plug in whatever your app already uses:

```typescript
// NextAuth
createWebAdapter({
  userName: "mybot",
  getUser: async (req) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) return null;
    return { id: session.user.id, name: session.user.name };
  },
});

// Clerk
createWebAdapter({
  userName: "mybot",
  getUser: async (req) => {
    const { userId, sessionClaims } = await auth();
    if (!userId) return null;
    return { id: userId, name: sessionClaims?.name as string | undefined };
  },
});

// Custom session cookie
createWebAdapter({
  userName: "mybot",
  getUser: async (req) => {
    const sessionId = req.headers.get("cookie")?.match(/session=([^;]+)/)?.[1];
    if (!sessionId) return null;
    const user = await db.users.findBySession(sessionId);
    return user ? { id: user.id, name: user.name } : null;
  },
});
```

If `getUser` throws, the adapter returns 401 and logs the error. Don't include sensitive data in the error message — it's not surfaced to the client, but it is logged.

> The resolved `user.id` is embedded in the chat-sdk thread id (see [Threading](#threading) below). User ids containing `:` are rejected with HTTP 400 because they would corrupt the round-trip through `decodeThreadId`. If your auth provider emits ids with colons (e.g. `provider:sub` claims), normalize them inside `getUser` — for example by base64-encoding.

## Threading

By default, each `useChat` conversation maps to one chat-sdk thread:

```
web:{user.id}:{conversationId}
```

`conversationId` is the `id` field useChat sends in its request body. If your client supplies one (`useChat({ id: "support-chat" })`), it's reused across reloads; otherwise a fresh id is generated per request.

`channel.messages` and `thread.messages` are equivalent on web — the channel id is the thread id. This avoids cross-conversation bleed when `persistMessageHistory` is enabled and the same user has multiple useChat conversations open.

To override (for example, one thread per user regardless of conversation):

```typescript
createWebAdapter({
  userName: "mybot",
  getUser: (req) => /* ... */,
  threadIdFor: ({ user }) => `web:${user.id}:default`,
});
```

The encode/decode helpers are exposed on the adapter:

```typescript
adapter.encodeThreadId({ userId: "u1", conversationId: "abc" });
// → "web:u1:abc"
adapter.decodeThreadId("web:u1:abc");
// → { userId: "u1", conversationId: "abc" }
```

## Streaming

`thread.post` accepts an `AsyncIterable<string | StreamChunk>` and pumps deltas straight onto the SSE response body — no edit loop, no rate limiting. Plays nicely with the AI SDK's `streamText`:

```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

bot.onDirectMessage(async (thread, message) => {
  const result = streamText({
    model: openai("gpt-4o"),
    prompt: message.text,
  });
  await thread.post(result.textStream);
});
```

The adapter honors `request.signal`, so calling `stop()` from `useChat` short-circuits the iterator on the server. `task_update` and `plan_update` `StreamChunk`s have no native v1 representation in the UI message stream and are dropped silently.

## Message persistence

`persistMessageHistory` defaults to **`true`**. Web has no platform-side history API, so the only way for chat-sdk handlers to see prior turns via `thread.messages` / `channel.messages` is through the configured state adapter's message history cache. Set it to `false` only if your handler re-derives history from the request body's `messages[]` itself:

```typescript
createWebAdapter({
  userName: "mybot",
  getUser: (req) => /* ... */,
  persistMessageHistory: false,
});
```

The AI SDK client retains the conversation in its UI state and resends it on every request, so opting out is a valid choice for stateless handlers — but anything that calls `await thread.messages` won't see prior turns.

## React hook

`@chat-adapter/web/react` exports a thin wrapper around `@ai-sdk/react`'s `useChat` preconfigured with `DefaultChatTransport`:

```tsx
import { useChat } from "@chat-adapter/web/react";

const { messages, sendMessage, status, stop, regenerate } = useChat({
  api: "/api/chat",        // default
  threadId: "support-1",   // becomes useChat's `id` and the request body's `id`
});
```

| Option | Description |
|--------|-------------|
| `api` | API endpoint for the Web adapter route. Defaults to `/api/chat`. |
| `threadId` | chat-sdk thread id — surfaces in the request body's `id` so the server can derive the chat-sdk thread id. Strongly recommended. Falls back to `id` from `ChatInit`. |
| `experimental_throttle` | Throttle wait in ms for chat messages and data updates. |
| `resume` | Whether to resume an ongoing chat generation stream. |
| ...rest | All other options pass through to `@ai-sdk/react`'s `useChat`. |

For advanced configuration (custom transport, response interceptors, etc.) use `@ai-sdk/react`'s `useChat` directly — there's nothing magical in the wrapper.

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `userName` | Yes | Bot username. Required by chat-sdk for mention detection (`@username`) and seeds the bot identity for assistant messages. |
| `getUser` | Yes | `(request: Request) => WebUser \| null \| Promise<WebUser \| null>`. Resolves the user from the inbound HTTP request. Returning `null` produces HTTP 401. |
| `persistMessageHistory` | No | Persist incoming message history in the configured state adapter. Default: `true`. |
| `threadIdFor` | No | Derive a chat-sdk thread id from the resolved user and the useChat conversation id. Default: `web:{user.id}:{conversationId}`. |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`). |

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | No (every assistant turn is a fresh streamed response) |
| Delete message | No |
| File uploads | No (deferred to v2) |
| Streaming | Native (SSE / UI message stream) |
| Scheduled messages | No |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Markdown only in v1 (cards/JSX deferred to v2) |
| Buttons | No |
| Tables | Yes (GFM markdown) |
| Modals | No |

### Conversations

| Feature | Supported |
|---------|-----------|
| Mentions | N/A (every web message routes as a DM) |
| Add reactions | No |
| Remove reactions | No |
| Typing indicator | N/A (useChat derives a `status` from the SSE response itself) |
| DMs | Yes — `isDM: true` for every thread |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Via state adapter cache (no platform API) |
| Fetch single message | No |
| Fetch thread info | Yes (synthesized) |
| Fetch channel messages | Via state adapter cache |
| List threads | No |
| Post channel message | No |

## v1 scope

**In:** text + markdown, native streaming, DM-style routing, persisted message history, abort propagation via `request.signal`.

**Out (deferred to v2):** cards/JSX rendering, reactions, modals, file uploads, edit/delete, multi-tab proactive push.

## Troubleshooting

### Every request returns 401

- `getUser` is returning `null` or throwing. Add a log inside it to confirm the request actually carries the session you expect.
- Cookies aren't being forwarded — check that `useChat` is mounted on the same origin as `/api/chat` (or that your transport passes credentials).

### Every request returns 400 "Invalid user id"

- The id returned by `getUser` contains a `:` character, which would corrupt the thread-id round-trip. Normalize the id inside `getUser` (for example, `id.replace(/:/g, "_")` or base64-encode it).

### `useChat` recreates state on every render

- Don't pass `id: undefined` to `useChat`. The wrapper guards against this internally — but if you're calling `@ai-sdk/react`'s `useChat` directly, omit `id` rather than passing `undefined`.

### `thread.messages` is empty

- `persistMessageHistory` is `false` and there is no platform-side history to fall back on. Either set it to `true` (the default) or read history from the request body's `messages[]` directly inside your handler.

## License

MIT
