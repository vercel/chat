# @chat-adapter/web

Web adapter for [`chat`](https://chat-sdk.dev) — lets a chat-sdk bot serve a browser UI alongside Slack, Teams, Discord, etc. The same `bot.onDirectMessage(...)` handler fires for every platform.

Speaks the [AI SDK UI message stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), so [`@ai-sdk/react`](https://www.npmjs.com/package/@ai-sdk/react)'s `useChat` and the [`ai-elements`](https://elements.ai-sdk.dev/) component library work out of the box.

## Install

```bash
pnpm add @chat-adapter/web ai @ai-sdk/react
```

## Server

```ts
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

bot.onDirectMessage(async ({ thread, message }) => {
  await thread.post(`You said: ${message.text}`);
});

// app/api/chat/route.ts
export const POST = bot.webhooks.web;
```

## Client

```tsx
"use client";
import { useChat } from "@chat-adapter/web/react";

export function Chat() {
  const { messages, sendMessage, status } = useChat();
  // ...render with ai-elements <Conversation>, <Message>, <PromptInput>
}
```

## v1 scope

In: text + markdown, streaming, DMs.
Out (deferred to v2): cards/JSX rendering, reactions, modals, file uploads, edit/delete, multi-tab proactive push.

See [chat-sdk.dev/docs/adapters/web](https://chat-sdk.dev/docs/adapters/web) for the full guide.
