# @chat-adapter/twilio

[![npm version](https://img.shields.io/npm/v/@chat-adapter/twilio)](https://www.npmjs.com/package/@chat-adapter/twilio)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/twilio)](https://www.npmjs.com/package/@chat-adapter/twilio)

Twilio adapter for [Chat SDK](https://chat-sdk.dev). Build SMS and MMS bots with Twilio Messaging webhooks and the Messages API.

## Installation

```bash
pnpm add @chat-adapter/twilio
```

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
