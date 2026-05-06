---
"@chat-adapter/web": minor
"chat": minor
---

Add **`@chat-adapter/web`** — a new platform adapter that lets a chat-sdk bot serve a browser chat UI alongside Slack/Teams/Discord, without writing any client-side glue.

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
