[![Twilio adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/twilio/og)](https://chat-sdk.dev/adapters/official/twilio)

# @chat-adapter/twilio

> npm package: [`@chat-adapter/twilio`](https://www.npmjs.com/package/@chat-adapter/twilio)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Twilio adapter for [Chat SDK](https://chat-sdk.dev). Build SMS and MMS bots with Twilio Messaging webhooks and the Messages API.

Documentation: [chat-sdk.dev/adapters/official/twilio](https://chat-sdk.dev/adapters/official/twilio) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/twilio
```

## Scaffold with the CLI

To scaffold a new Twilio bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter twilio memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

The adapter auto-detects `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and `TWILIO_MESSAGING_SERVICE_SID` from environment variables:

```typescript
import { createTwilioAdapter } from "@chat-adapter/twilio";
import { Chat } from "chat";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    twilio: createTwilioAdapter(),
  },
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

Point your Twilio Messaging webhook to a route that calls `bot.webhooks.twilio(request)`:

```typescript
import { bot } from "@/lib/bot";

export async function POST(request: Request): Promise<Response> {
  return bot.webhooks.twilio(request);
}
```

## Configuration

```typescript
createTwilioAdapter({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  webhookUrl: "https://your-domain.com/api/webhooks/twilio",
});
```

Use `phoneNumber` for a single Twilio number, or `messagingServiceSid` when sending through a Twilio Messaging Service.

## Media

Inbound MMS media is exposed as attachments. Twilio media URLs are private, so attachments include `fetchData()` for authenticated downloads.

Outbound MMS supports attachments with public `url` values. Chat SDK cannot upload binary files to Twilio because Twilio's Messages API requires media URLs that Twilio can fetch.

## Low-level helpers

Runtime-light `api`, `format`, `voice`, and `webhook` subpaths are available for apps that only need Twilio primitives. These subpaths do not import the full Chat SDK adapter or the `twilio` npm package.

## Voice

Voice calls are exposed as low-level helpers, not routed through the SMS/MMS adapter. Use `@chat-adapter/twilio/voice` with `@chat-adapter/twilio/webhook` when your app owns the voice route and wants reusable TwiML or call-update helpers.

Custom voice routes should verify the Twilio signature and apply your own caller allow-list before returning TwiML.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit — it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
