[![Instagram Direct Messages adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/instagram/og)](https://chat-sdk.dev/adapters/official/instagram)

# @chat-adapter/instagram

> npm package: [`@chat-adapter/instagram`](https://www.npmjs.com/package/@chat-adapter/instagram)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Native Instagram Direct Messages adapter for [Chat SDK](https://chat-sdk.dev).
It uses Meta's Instagram API with Instagram Login and does not require an
aggregator.

Documentation: [chat-sdk.dev/adapters/official/instagram](https://chat-sdk.dev/adapters/official/instagram) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

> Building for Facebook Messenger? Use [`@chat-adapter/messenger`](https://chat-sdk.dev/adapters/official/messenger) instead. It connects through the Messenger Platform API and uses a Facebook Page access token.

## Installation

```bash
pnpm add @chat-adapter/instagram
```

## Scaffold with the CLI

```bash
npx create-chat-sdk@latest my-bot --adapter instagram memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other
available official and vendor-official adapters.

## Configure

```bash
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_APP_SECRET=
INSTAGRAM_VERIFY_TOKEN=
INSTAGRAM_ACCOUNT_ID=
# Optional; defaults to v26.0
INSTAGRAM_API_VERSION=
```

The Instagram account must be a professional Business or Creator account. The
Meta app needs `instagram_business_basic` and
`instagram_business_manage_messages`; production apps serving accounts they do
not own require Advanced Access.

Subscribe the Instagram webhook object to `messages`, `messaging_postbacks`,
`messaging_reactions`, `messaging_seen`, `messaging_referrals`, and
`messaging_optins`.

## Use

```ts
import { createInstagramAdapter } from "@chat-adapter/instagram";
import { Chat } from "chat";

const bot = new Chat({
  userName: "mystore",
  adapters: {
    instagram: createInstagramAdapter(),
  },
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post(`Thanks for reaching out! You said: ${message.text}`);
});

export const POST = bot.webhooks.instagram;
export const GET = bot.webhooks.instagram;
```

Thread IDs use `instagram:{accountId}:{igsid}` so conversations stay scoped to
the professional account that received them.

## Features

- Receive and send text DMs
- Receive story replies, story mentions, shares, media, and reactions
- Send image, video, audio, and PDF attachments by public HTTPS URL or upload
- Cards using Instagram templates or quick replies
- Typing indicators
- Buffered streaming
- Signed webhooks and subscription verification

Instagram does not support message editing, message deletion, group chats, or
modals through this API.

## Messaging window

Free-form replies must be sent within 24 hours of the customer's latest
message. Window failures are surfaced as a typed `ValidationError`.

For a real human support agent with the required Meta permission, the adapter
exposes:

```ts
await instagram.sendHumanAgentMessage(threadId, "A human follow-up");
```

`HUMAN_AGENT` extends the window to seven days and is audited by Meta. It must
not be used for automated messages.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor,
install the Chat SDK skill before writing code:

```bash
npx skills add vercel/chat
```

The skill references the bundled documentation in `node_modules/chat/docs`.
You can also install the optional
[Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin):

```bash
npx plugins add vercel/vercel-plugin
```

For agent-readable documentation, see
[chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) or
[chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt).

## License

MIT
