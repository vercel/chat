[![Facebook Messenger adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/messenger/og)](https://chat-sdk.dev/adapters/official/messenger)

# @chat-adapter/messenger

> npm package: [`@chat-adapter/messenger`](https://www.npmjs.com/package/@chat-adapter/messenger)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Facebook Messenger adapter for [Chat SDK](https://chat-sdk.dev), using the [Messenger Platform API](https://developers.facebook.com/docs/messenger-platform).

Documentation: [chat-sdk.dev/adapters/official/messenger](https://chat-sdk.dev/adapters/official/messenger) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

> Building for Instagram Direct Messages? Use [`@chat-adapter/instagram`](https://chat-sdk.dev/adapters/official/instagram) instead. It connects through Instagram API with Instagram Login and does not require a Facebook Page.

## Installation

```bash
pnpm add @chat-adapter/messenger @chat-adapter/state-memory
```

## Scaffold with the CLI

To scaffold a new Messenger bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter messenger memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createMessengerAdapter } from "@chat-adapter/messenger";
import { createMemoryState } from "@chat-adapter/state-memory";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    messenger: createMessengerAdapter(),
  },
  state: createMemoryState(),
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post("Hello from Messenger!");
});
```

When using `createMessengerAdapter()` without arguments, credentials are auto-detected from environment variables.

The memory state adapter keeps subscriptions and locks in process memory, which suits local development. Use a Redis or PostgreSQL state adapter in production.

## Facebook Messenger setup

### 1. Create a Meta app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Click **Create App**
3. Select the use case **"Engage with customers on Messenger from Meta"**
4. Enter your app name and contact email, then create the app
5. Go to **App > App Settings > Basic** and copy your **App Secret** — this becomes `FACEBOOK_APP_SECRET`

### 2. Create a Facebook Page

Your Messenger bot needs a Facebook Page to send and receive messages. If you don't have one:

1. The easiest approach is to create a **Facebook Business profile** first
2. Then create a Page under that business profile
3. Note the Page name — users will message this Page to interact with your bot

### 3. Configure Messenger API

1. In your Meta app dashboard, go to **Use Cases**
2. Find **"Engage with customers on Messenger from Meta"** and click **Customize**
3. Then open **Messenger API Settings**

#### Configure webhooks

1. Under **Configure webhooks**, click **Add Callback URL**
2. Enter your webhook URL: `https://your-domain.com/api/webhooks/messenger`
3. Enter a **Verify Token** — this is a secret string you create (this becomes `FACEBOOK_VERIFY_TOKEN`)
4. Click **Verify and Save**
5. After verification, click **Add Subscriptions** and enable:
   - `messages`
   - `messaging_postbacks`
   - `messaging_reactions`
   - `message_deliveries`
   - `message_reads`

#### Generate a Page Access Token

1. Under **Generate access tokens**, click **Add or remove Pages**
2. Your Pages should populate — select the Page you created
3. Assign the standard permissions when prompted
4. Click **Generate Token**
5. Copy the token — this becomes `FACEBOOK_PAGE_ACCESS_TOKEN`

## Configuration

You can call `createMessengerAdapter()` with no arguments when the environment variables are set.

| Option | Required | Description |
|--------|----------|-------------|
| `appSecret` | No* | App secret for webhook signature verification. Auto-detected from `FACEBOOK_APP_SECRET` |
| `pageAccessToken` | No* | Page access token. Auto-detected from `FACEBOOK_PAGE_ACCESS_TOKEN` |
| `verifyToken` | No* | Webhook verify token. Auto-detected from `FACEBOOK_VERIFY_TOKEN` |
| `apiVersion` | No | Graph API version (defaults to `v21.0`) |
| `userName` | No | Bot username. Defaults to the Page name, or to the `userName` passed to `Chat` when the Page lookup fails |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*Required at runtime, either in config or as an environment variable.

## Environment variables

```bash
FACEBOOK_APP_SECRET=...              # App secret from App Settings > Basic
FACEBOOK_PAGE_ACCESS_TOKEN=...       # Generated Page access token
FACEBOOK_VERIFY_TOKEN=...            # Webhook verify token that you choose
```

All three are required unless you pass the matching option to `createMessengerAdapter()`.

## Webhook setup

Messenger uses two webhook mechanisms:

1. **Verification handshake** (GET). Meta sends `hub.mode=subscribe` and a `hub.verify_token` that must match your `FACEBOOK_VERIFY_TOKEN`. A mismatch gets a 403 response.
2. **Event delivery** (POST). Incoming messages, reactions, and postbacks are verified with the `X-Hub-Signature-256` header. A missing or wrong signature gets a 403 response.

```typescript
// Next.js App Router example
import { after } from "next/server";
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.messenger(request);
}

export async function POST(request: Request) {
  return bot.webhooks.messenger(request, {
    waitUntil: (task) => after(() => task),
  });
}
```

The adapter responds before your handlers finish, so pass `waitUntil` on serverless platforms to keep the function alive until they do.

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | No (Messenger limitation) |
| Delete message | No (Messenger limitation) |
| Streaming | Buffered (accumulates then sends) |
| Typing indicator | Yes |
| Mark as read | Yes |
| File uploads | No |

Text is limited to 2000 characters. Longer text is cut to 1997 characters followed by `...`, and isn't split across messages.

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Generic/Button Templates |
| Buttons | Yes (max 3 per message) |
| Link buttons | Yes (web_url) |
| Select menus | No |
| Tables | Text fallback |
| Fields | Rendered as `Label: Value` text lines |
| Images in cards | Card `imageUrl` only (Generic Template) |
| Modals | No |

### Conversations

| Feature | Supported |
|---------|-----------|
| Reactions | Receive only |
| DMs | Yes (DM-only platform) |
| Postbacks | Yes |

Every inbound message is treated as a mention, because each conversation is a direct message with your Page. Button taps arrive through `onAction`. A quick-reply tap arrives as an ordinary text message.

### Inbound attachments

Inbound attachment URLs remain available as `attachment.url`. The adapter's
`fetchData` function downloads media only from Meta's `fbsbx.com` and
`fbcdn.net` hosts, refuses private and internal addresses (including after
redirects), limits responses to 25 MB, and times out after 30 seconds.
External fallback and link-share URLs are preserved but rejected before any
network request.

### Read receipts

Use `thread.markAsRead()` in a message handler to send Messenger's `mark_seen` sender action:

```typescript
await thread.markAsRead();
```

Messenger applies this action to the conversation's seen state rather than a single message, even when you pass a message or message ID.

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | In-memory cache only |
| Fetch thread info | Yes |

Messenger has no API for listing past messages, so `fetchMessages` reads from an in-memory cache of the messages this process has received and sent. The cache is empty after a restart and isn't shared between instances.

## Interactive messages

The adapter converts a card to one Messenger template when it can:

- **Generic Template**: the card has at least one button and a `title` or `imageUrl`.
- **Button Template**: the card has at least one button and body text, but no title or image.
- **Text**: the card has no buttons, or contains a table, select menu, or radio select.

The adapter trims content to Messenger's limits and doesn't fall back to text for them:

- Only the first 3 buttons are sent. Extra buttons are dropped.
- Button labels longer than 20 characters are truncated with an ellipsis.
- Titles and subtitles longer than 80 characters are truncated.
- Button Template text longer than 640 characters is truncated.

## API errors

Failed Graph API calls throw the error classes from `@chat-adapter/shared`:

| Response | Error |
|----------|-------|
| HTTP 429, or Meta codes 4, 32, 613 | `AdapterRateLimitError`, with `retryAfter` in seconds when Meta sends a `Retry-After` header |
| HTTP 401, or Meta code 190 | `AuthenticationError` |
| HTTP 403, or Meta codes 10, 200 | `ValidationError` |
| HTTP 404 | `ResourceNotFoundError` |
| Anything else, and network failures | `NetworkError` |

The adapter sends every message as a standard response and doesn't track Messenger's 24-hour messaging window. A send outside the window fails with the error the Graph API returns.

## Thread ID format

```
messenger:{recipientId}
```

Example: `messenger:27161130920158013`

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
