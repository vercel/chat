# @chat-adapter/webhook

> npm package: [`@chat-adapter/webhook`](https://www.npmjs.com/package/@chat-adapter/webhook)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Generic webhook adapter for [Chat SDK](https://chat-sdk.dev). Connect any platform that delivers messages as HTTP webhooks and accepts replies over HTTP by describing how to read its webhooks and send its replies.

Documentation: [chat-sdk.dev/adapters/official/webhook](https://chat-sdk.dev/adapters/official/webhook) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/webhook
```

## Scaffold with the CLI

To scaffold a new bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter webhook memory
```

The generated `bot.ts` contains placeholder `parse` and `send` functions to fill in for your platform.

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createWebhookAdapter } from "@chat-adapter/webhook";

interface PlatformEvent {
  chatId: string;
  messageId: string;
  text: string;
  sender: { id: string };
}

const bot = new Chat({
  userName: "mybot",
  adapters: {
    webhook: createWebhookAdapter({
      parse: (event: PlatformEvent) => ({
        id: event.messageId,
        channelId: event.chatId,
        text: event.text,
        author: { userId: event.sender.id },
        isMention: true,
      }),
      send: async ({ channelId, text }) => {
        await fetch("https://api.example.com/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: channelId, text }),
        });
      },
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

Route `POST /api/webhooks/webhook` to `bot.webhooks.webhook(request)`.

## Verification

The adapter verifies an HMAC-SHA256 hex digest of the raw body, read from the `x-webhook-signature` header with or without a `sha256=` prefix, using `WEBHOOK_SECRET`. Change the header with `signatureHeader`, or pass a `verify` function for other schemes. `createWebhookAdapter` throws when neither a secret nor `verify` is set.

## Optional callbacks

- `edit`: enables `editMessage` and incremental streaming.
- `delete`: enables `deleteMessage`.
- `startTyping`: enables typing indicators.

## Thread IDs

`{name}:{base64url(channelId)}` or `{name}:{base64url(channelId)}:{base64url(threadId)}`. Set `name` to the key you register the adapter under in `adapters`. It defaults to `webhook`.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
