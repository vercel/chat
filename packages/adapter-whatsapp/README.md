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

## Inbound attachments

Incoming media attachments expose a lazy `fetchData()`. Media is downloaded only from Meta's `fbcdn.net` and `fbsbx.com` hosts or the configured Graph origin. Downloads refuse private and internal addresses, are limited to 25 MB, and time out after 30 seconds, and the access token never follows a redirect off those hosts. Pass a custom transport to `downloadMedia()` to route downloads through a proxy.

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
| Link buttons | Partial (single link button becomes a native CTA URL message) |
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

### Typing indicators

WhatsApp supports typing indicators through `thread.startTyping()` or `adapter.startTyping(threadId)`.

Use it when the bot is about to respond and may take a few seconds. The adapter uses the most recent inbound message ID from thread history, so `startTyping()` only works after the bot has received a message.

```typescript
await thread.startTyping();

await thread.post({
  markdown: "Thanks, I am checking that now.",
});
```

WhatsApp-specific behavior:

- If there is no inbound message context, `startTyping()` no-ops.
- The typing indicator is dismissed when the bot sends its reply, or after the WhatsApp platform timeout.

### Read receipts

Use `thread.markAsRead()` in a message handler to acknowledge the current inbound message:

```typescript
await thread.markAsRead();
```

You can also pass an inbound `Message` or its ID. WhatsApp marks that message and earlier messages in the conversation as read. It does not allow outgoing message IDs to be marked as read and recommends acknowledging inbound messages within 30 days.

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

When a card with reply buttons also contains link buttons, each link button is appended to the interactive message body as a `Label: url` line, since WhatsApp reply buttons cannot open URLs.

### Link buttons (CTA URL)

A card whose only interactive element is a single link button is sent as a native CTA URL message with a tappable link button. The card is promoted only when all of these hold:

- The link button is the card's only action across every actions row, including rows nested in sections. Reply buttons, selects, radio selects, or a second populated actions row keep the text fallback.
- The URL starts with `http://` or `https://` and the label is non-empty. Other schemes (`mailto:`, `tel:`, relative paths) keep the text fallback because the Cloud API rejects them.
- The card has no header image and no image, table, chart, or inline link children. Text, fields, sections, and dividers are fine.
- The post has no files or attachments. When media accompanies the card, the adapter keeps the single captioned media send, and the caption includes a `Label: url` line for each link button.

The button label is truncated to 20 characters, the header (card title) to 60, and the body to 1024. Cards that do not match these rules fall back to formatted text, where link buttons render as `Label: url`.

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

## API errors

A non-2xx Graph API response throws `WhatsAppApiError`, exported from `@chat-adapter/whatsapp`. It extends `AdapterError`, so existing `instanceof AdapterError` checks continue to work.

```typescript
import { WhatsAppApiError } from "@chat-adapter/whatsapp";

try {
  await thread.post("Hello");
} catch (error) {
  if (error instanceof WhatsAppApiError) {
    console.error(error.code, error.errorCode, error.details, error.status);
  }
  throw error;
}
```

- `code`: the shared `AdapterError` code when the failure maps onto one: `RATE_LIMITED` (HTTP 429, or Meta throttling codes such as `130429` and `80007`), `AUTH_FAILED` (HTTP 401, or Meta codes `0` and `190`), `PERMISSION_DENIED` (HTTP 403, or Meta codes `3`, `10`, and `200` to `299`), `NOT_FOUND` (HTTP 404). Otherwise `undefined`.
- `errorCode`: Meta's numeric error code, such as `130429`
- `providerMessage` and `type`: Meta's `error.message` and `error.type`, when present
- `details`: Meta's `error_data.details`, when present
- `status`: HTTP response status
- `subcode` and `traceId`: Meta's `error_subcode` and `fbtrace_id`, when present
- `raw`: the full parsed response body (see the `WhatsAppGraphErrorBody` type), or the original text if it is not valid JSON

Meta recommends using [error codes and details](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes/) for error handling. Subcodes are optional and deprecated in the Cloud API. Missing or malformed provider fields stay `undefined`, and numeric codes that a proxy serializes as strings are accepted. The error message combines the operation, the HTTP status, and Meta's `error.message`, or a bounded excerpt of a non-JSON body.

This covers non-2xx responses from message sends, templates, reactions, read receipts, typing requests, media uploads, and media metadata requests. Transport failures and unparseable response bodies throw `NetworkError`, as do binary media download failures. A 2xx response that reports `success: false` for a typing request or read receipt throws a plain `AdapterError`. A successful API response can still be followed by an asynchronous delivery failure; those webhook errors are not thrown as `WhatsAppApiError`.

## User identity

WhatsApp messages include a [business-scoped user ID](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/) in `from_user_id` and `contacts[].user_id`. Users with a username may omit the phone-based `from` and `wa_id` fields.

The adapter accepts either identifier. When both are available, it preserves an existing phone-based thread ID and stores the BSUID as an alias. Replies include both `to` and `recipient`, with the phone number taking precedence according to Meta's API. BSUID-only threads send through `recipient`.

Meta does not support BSUID recipients for one-tap, zero-tap, or copy-code authentication templates. Those templates require the user's phone number.

Use a persistent state adapter in production so identity aliases survive restarts. The adapter preserves the canonical thread when Meta rotates a BSUID by consuming `user_changed_number` and `user_changed_user_id` system messages plus the `user_id_update` webhook, which carries the previous and current BSUID. Subscribe your Meta app to the `user_id_update` webhook field so rotations reach the adapter. Current phone, BSUID, parent BSUID, and username fields remain available through `message.raw`.

## Thread ID format

```
whatsapp:{phoneNumberId}:{userWaId}
```

Example: `whatsapp:1234567890:15551234567`

The final segment is the adapter's canonical user identifier. It may contain a phone number, a BSUID such as `US.13491208655302741918`, or a previously observed identifier retained for thread continuity.

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
