[![WhatsApp Business Cloud adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/whatsapp/og)](https://chat-sdk.dev/adapters/official/whatsapp)

# @chat-adapter/whatsapp

> npm package: [`@chat-adapter/whatsapp`](https://www.npmjs.com/package/@chat-adapter/whatsapp)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

WhatsApp Business Cloud adapter for [Chat SDK](https://chat-sdk.dev), using the [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).

Documentation: [chat-sdk.dev/adapters/official/whatsapp](https://chat-sdk.dev/adapters/official/whatsapp) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/whatsapp
```

## Scaffold with the CLI

To scaffold a new WhatsApp bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter whatsapp memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    whatsapp: createWhatsAppAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from WhatsApp!");
});
```

When using `createWhatsAppAdapter()` without arguments, credentials are auto-detected from environment variables.

## WhatsApp Business setup

### 1. Create a Meta app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Click **Create App**, select **Business** type
3. Add the **WhatsApp** product to your app
4. Go to **WhatsApp > API Setup** and note your **Phone Number ID** and **Access Token**

### 2. Configure webhooks

1. Go to **WhatsApp > Configuration** in your Meta app
2. Set **Callback URL** to `https://your-domain.com/api/webhooks/whatsapp`
3. Set **Verify Token** to a secret string of your choice (this becomes `WHATSAPP_VERIFY_TOKEN`)
4. Subscribe to the `messages` webhook field

### 3. Get credentials

From your Meta app dashboard, copy:

- **App Secret** (under **App Settings > Basic**) as `WHATSAPP_APP_SECRET`
- **Access Token** (under **WhatsApp > API Setup**) as `WHATSAPP_ACCESS_TOKEN`
- **Phone Number ID** (under **WhatsApp > API Setup**) as `WHATSAPP_PHONE_NUMBER_ID`

For production, generate a permanent **System User Token** instead of the temporary access token.

## Configuration

All options are auto-detected from environment variables when not provided. You can call `createWhatsAppAdapter()` with no arguments if the env vars are set.

| Option | Required | Description |
|--------|----------|-------------|
| `accessToken` | No* | Meta access token. Auto-detected from `WHATSAPP_ACCESS_TOKEN` |
| `appSecret` | No* | App secret for webhook verification. Auto-detected from `WHATSAPP_APP_SECRET` |
| `phoneNumberId` | No* | Bot's phone number ID. Auto-detected from `WHATSAPP_PHONE_NUMBER_ID` |
| `verifyToken` | No* | Webhook verification secret. Auto-detected from `WHATSAPP_VERIFY_TOKEN` |
| `apiVersion` | No | Graph API version (defaults to `v25.0`) |
| `userName` | No | Bot username for self-message detection. Auto-detected from `WHATSAPP_BOT_USERNAME` (defaults to `whatsapp-bot`) |
| `apiUrl` | No | Override the Meta Graph API base URL. Auto-detected from `WHATSAPP_API_URL` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*Required at runtime — either via config or environment variable.

## Environment variables

```bash
WHATSAPP_ACCESS_TOKEN=...          # Meta access token (permanent or system user token)
WHATSAPP_APP_SECRET=...            # App secret for X-Hub-Signature-256 verification
WHATSAPP_PHONE_NUMBER_ID=...       # Bot's phone number ID from Meta dashboard
WHATSAPP_VERIFY_TOKEN=...          # User-defined secret for webhook verification
WHATSAPP_BOT_USERNAME=...          # Optional, defaults to "whatsapp-bot"
WHATSAPP_API_URL=...               # Optional, override the Meta Graph API base URL
```

## Webhook setup

WhatsApp uses two webhook mechanisms:

1. **Verification handshake** (GET) — Meta sends a `hub.verify_token` challenge that must match your `WHATSAPP_VERIFY_TOKEN`.
2. **Event delivery** (POST) — incoming messages, reactions, and interactive responses, verified via `X-Hub-Signature-256`.

```typescript
// Next.js App Router example
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.whatsapp(request);
}

export async function POST(request: Request) {
  return bot.webhooks.whatsapp(request);
}
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | No (WhatsApp limitation) |
| Delete message | No (WhatsApp limitation) |
| Streaming | Buffered (accumulates then sends) |
| Mark as read | Yes |
| Auto-chunking | Yes (splits at 4096 chars) |
| Template messages | Yes (via `sendTemplate`) |

### Rich content

| Feature | Supported |
|---------|-----------|
| Interactive buttons | Yes (up to 3) |
| Button title limit | 20 characters |
| List messages | Yes |
| Text fallback | Yes (for >3 buttons) |

### Conversations

| Feature | Supported |
|---------|-----------|
| Reactions | Yes (add and remove) |
| Typing indicator | Yes (requires a recent inbound message, marks it as read, and displays for up to 25 seconds) |
| DMs | Yes |
| Open DM | Yes |

### Incoming message types

| Type | Supported |
|------|-----------|
| Text | Yes |
| Images | Yes (with captions) |
| Documents | Yes (with captions) |
| Audio / Voice | Yes |
| Video | Yes (with captions) |
| Stickers | Yes |
| Locations | Yes (converted to map URL) |
| Interactive replies | Yes (button and list) |
| Reactions | Yes |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | No (Cloud API limitation) |
| Fetch thread info | Yes |

## Interactive messages

Card elements are automatically converted to WhatsApp interactive messages:

- **3 or fewer buttons** — rendered as WhatsApp reply buttons (max 20 chars per title)
- **More than 3 buttons** — falls back to formatted text
- **Max body text** — 1024 characters

## Template messages

Outside the 24-hour customer service window, WhatsApp only accepts pre-approved [template messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates). Use `sendTemplate` to start business-initiated conversations:

```typescript
const threadId = await adapter.openDM("15551234567");

await adapter.sendTemplate(threadId, {
  name: "appointment_reminder",
  language: "en",
  components: [
    {
      type: "body",
      parameters: [{ type: "text", text: "Tomorrow at 2pm" }],
    },
  ],
});
```

Templates must be created and approved in [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/) before they can be sent. Quick reply button taps on a template arrive as button responses and are dispatched to your `onAction` handlers.

## Thread ID format

```
whatsapp:{phoneNumberId}:{userWaId}
```

Example: `whatsapp:1234567890:15551234567`

## Troubleshooting

### Webhook verification failing

- Confirm `WHATSAPP_VERIFY_TOKEN` matches the value you entered in the Meta dashboard
- Ensure your endpoint returns the `hub.challenge` value for GET requests

### Messages not arriving

- Check that you subscribed to the `messages` webhook field in Meta app settings
- Verify `WHATSAPP_APP_SECRET` is correct — signature verification silently rejects invalid payloads
- Ensure your phone number is registered and verified in the WhatsApp Business dashboard

### "Invalid signature" errors

- Double-check `WHATSAPP_APP_SECRET` matches the value under **App Settings > Basic**
- The adapter uses HMAC-SHA256 to verify the `X-Hub-Signature-256` header

### Token expired

- Temporary tokens from the API Setup page expire after 24 hours
- For production, create a **System User** in Meta Business Suite and generate a permanent token

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
