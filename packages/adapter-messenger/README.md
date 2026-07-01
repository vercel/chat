[![Facebook Messenger adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/messenger/og)](https://chat-sdk.dev/adapters/official/messenger)

# @chat-adapter/messenger

> npm package: [`@chat-adapter/messenger`](https://www.npmjs.com/package/@chat-adapter/messenger)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Facebook Messenger adapter for [Chat SDK](https://chat-sdk.dev), using the [Messenger Platform API](https://developers.facebook.com/docs/messenger-platform).

Documentation: [chat-sdk.dev/adapters/official/messenger](https://chat-sdk.dev/adapters/official/messenger) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/messenger
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

const bot = new Chat({
  userName: "mybot",
  adapters: {
    messenger: createMessengerAdapter(),
  },
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post("Hello from Messenger!");
});
```

When using `createMessengerAdapter()` without arguments, credentials are auto-detected from environment variables.

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

## Environment variables

```bash
FACEBOOK_APP_SECRET=...              # App secret from App Settings > Basic
FACEBOOK_PAGE_ACCESS_TOKEN=...       # Generated Page access token
FACEBOOK_VERIFY_TOKEN=...            # User-defined webhook verification secret
FACEBOOK_BOT_USERNAME=...            # Optional, defaults to "messenger-bot"
FACEBOOK_API_URL=...                 # Optional, override the Meta Graph API base URL
```

## Webhook setup

Messenger uses two webhook mechanisms:

1. **Verification handshake** (GET) — Meta sends a `hub.verify_token` challenge that must match your `FACEBOOK_VERIFY_TOKEN`.
2. **Event delivery** (POST) — incoming messages, reactions, and postbacks, verified via `X-Hub-Signature-256`.

```typescript
// Next.js App Router example
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.messenger(request);
}

export async function POST(request: Request) {
  return bot.webhooks.messenger(request);
}
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | No (Messenger limitation) |
| Delete message | No (Messenger limitation) |
| Streaming | Buffered (accumulates then sends) |
| Typing indicator | Yes |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Generic/Button Templates |
| Buttons | Yes (max 3 per message) |
| Link buttons | Yes (web_url) |
| Select menus | No |
| Tables | Text fallback |
| Fields | Text fallback |
| Images in cards | Yes (Generic Template) |
| Modals | No |

### Conversations

| Feature | Supported |
|---------|-----------|
| Reactions | Receive only |
| Typing indicator | Yes |
| DMs | Yes (DM-only platform) |
| Postbacks | Yes |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Cached sent messages only |
| Fetch thread info | Yes |

## Interactive messages

Card elements are automatically converted to Messenger templates:

- **Generic Template** — Used when the card has a `title` or `imageUrl`. Supports up to 3 buttons.
- **Button Template** — Used when the card has text content and buttons but no title/image. Max 640 characters.
- **Text Fallback** — Used when the card contains unsupported elements (tables, select menus) or exceeds constraints.

Template constraints:

- Maximum 3 buttons per template
- Button titles limited to 20 characters (truncated with ellipsis)
- Subtitles limited to 80 characters
- Button Template text limited to 640 characters

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
