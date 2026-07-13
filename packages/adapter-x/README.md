[![X adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/x/og)](https://chat-sdk.dev/adapters/official/x)

# @chat-adapter/x

> npm package: [`@chat-adapter/x`](https://www.npmjs.com/package/@chat-adapter/x)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

X (Twitter) adapter for [Chat SDK](https://chat-sdk.dev), using the [X API v2](https://docs.x.com/x-api/overview) and the [X Activity API](https://docs.x.com/x-api/activity/introduction). Reply to public mentions, hold DM conversations, post from the bot account, and like posts.

Documentation: [chat-sdk.dev/adapters/official/x](https://chat-sdk.dev/adapters/official/x) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/x
```

## Scaffold with the CLI

To scaffold a new X bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter x memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createXAdapter } from "@chat-adapter/x";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    x: createXAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post(`Hi @${message.author.userName}!`);
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post("Hello from X!");
});
```

When using `createXAdapter()` without arguments, credentials are auto-detected from environment variables.

## X setup

### 1. Create an X app

1. Go to the [X developer portal](https://developer.x.com) and create a Project and App
2. Under **Keys and tokens**, copy the **API Key Secret** (consumer secret): this becomes `X_CONSUMER_SECRET`
3. Enable **OAuth 2.0** user authentication with the scopes `tweet.read`, `tweet.write`, `users.read`, `dm.read`, `dm.write`, `like.write`, and `offline.access`
4. Complete the OAuth 2.0 flow for the bot account. Either store the access token as `X_USER_ACCESS_TOKEN`, or store `X_CLIENT_ID` plus `X_REFRESH_TOKEN` to let the adapter manage token refresh

### 2. Register a webhook

X delivers events through the [X Activity API](https://docs.x.com/x-api/activity/introduction). Set this up once in the [X developer console](https://console.x.com), which handles the auth for you:

1. Register your webhook URL (`https://your-domain.com/api/webhooks/x`). It must be public HTTPS without a port. X immediately sends a CRC challenge, which the adapter answers automatically
2. Create subscriptions for the events the adapter consumes: `post.mention.create`, `dm.received`, and `dm.sent` (private events, so the bot user must have authorized your app first)

Subscription and webhook management is one-time setup, not adapter runtime. If you script it instead of using the console, the Activity API endpoints are auth-picky and operation-specific and do not fully match the published spec (creating a private-event subscription needed OAuth 1.0a user context in testing, while list and delete used the app-only bearer token), so the console is the simpler path.

### 3. Environment variables

```bash
X_CONSUMER_SECRET=...      # App API key secret, used for webhook CRC and signature verification

# Auth option A: static access token
X_USER_ACCESS_TOKEN=...    # OAuth 2.0 user-context access token for outbound calls

# Auth option B: managed OAuth refresh (recommended for long-running bots)
X_CLIENT_ID=...            # OAuth 2.0 client ID
X_REFRESH_TOKEN=...        # OAuth 2.0 refresh token (requires the offline.access scope)
X_CLIENT_SECRET=...        # Optional, only for confidential clients
X_ENCRYPTION_KEY=...       # Optional, base64 32-byte key to encrypt persisted tokens

X_USER_ID=...              # Bot account user ID. Optional if omitted it is fetched from /2/users/me; the adapter requires a resolvable bot id and fails init otherwise
X_USERNAME=...             # Optional, bot @handle for mention detection (fetched when omitted)
X_API_BASE_URL=...         # Optional, override the X API base URL
```

### Token refresh

X OAuth 2.0 user tokens are short-lived (about two hours). With `X_CLIENT_ID` and `X_REFRESH_TOKEN` set, the adapter refreshes the access token before expiry and persists the rotated refresh token in your state adapter, so the bot survives restarts. Set `X_ENCRYPTION_KEY` to store those tokens AES-256-GCM encrypted.

Alternatively, pass a token provider and plug in your own refresh logic:

```typescript
import { createXAdapter } from "@chat-adapter/x";

const adapter = createXAdapter({
  userAccessToken: async () => refreshTokenFromMyStore(),
});
```

## Webhook setup

X uses two webhook mechanisms, both handled by the adapter:

1. **CRC challenge** (GET): X sends a `crc_token` that the adapter answers with an HMAC-SHA256 response keyed by your consumer secret. X re-validates hourly
2. **Event delivery** (POST): activity events signed via the `x-twitter-webhooks-signature` header, verified against the raw request body

```typescript
// Next.js App Router example
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.x(request);
}

export async function POST(request: Request) {
  return bot.webhooks.x(request);
}
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes (mention replies and DMs) |
| Top-level posts | Yes (`channel.post` on `x:public`) |
| Edit message | Posts only (X edit eligibility rules apply) |
| Delete message | Posts and own DM events |
| Streaming | Buffered (accumulates then posts once) |
| Typing indicator | No |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Plain text fallback |
| Buttons | No (link buttons render as text) |
| Tables | ASCII |
| Modals | No |
| Image uploads | Yes (png, jpeg, webp; up to 4 per post; also DMs) |

Attach images by passing `files` (or `attachments`) on the message; the adapter uploads each through X's chunked media endpoints (`initialize` then `append` then `finalize`) and attaches the returned `media_id`s to the post or DM. A post can carry media with or without text.

```typescript
await thread.post({
  markdown: "France lead the title race",
  files: [{ data: pngBuffer, filename: "odds.png", mimeType: "image/png" }],
});
```

Media upload requires the `media.write` scope on your OAuth 2.0 token, in addition to `tweet.write`. Mint the token with `media.write` included or uploads fail with a 403.

### Conversations

| Feature | Supported |
|---------|-----------|
| Mentions | Yes (`post.mention.create`) |
| DMs | Yes (`dm.received` / `dm.sent`) |
| Reactions | Likes only (`emoji.heart` or `"like"`) |
| User lookup | Yes |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | DMs via API, posts from cache |
| Fetch single message | Posts via API, DMs from cache |

## Thread ID format

```
x:post:{conversationId}   # public post threads (channel: x:public)
x:dm:{participantUserId}  # direct message with a single user
```

Examples: `x:post:1943467279943467279`, `x:dm:783214`. X DM webhooks carry no conversation id, only participant ids, so DMs are threaded by the other participant's user id: `openDM("783214")` returns `x:dm:783214`, and sends route to `POST /2/dm_conversations/with/783214/messages`. Top-level posts go through `channel.post` on the `x:public` channel.

## Automation policy

X enforces [automation rules](https://docs.x.com/developer-terms/policy). Before deploying a bot:

- get explicit consent before sending automated replies or DMs, and honor opt-outs immediately
- disclose the bot identity in the account profile
- never send bulk, duplicate, or aggressive automated content
- use only the official API (no scraping or browser automation)

The adapter is strict by default: it never streams by post-and-edit, rejects unsupported interactions loudly, and only replies where your handlers decide to.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit: it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
