# @chat-adapter/linear

[![npm version](https://img.shields.io/npm/v/@chat-adapter/linear)](https://www.npmjs.com/package/@chat-adapter/linear)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/linear)](https://www.npmjs.com/package/@chat-adapter/linear)

Linear adapter for [Chat SDK](https://chat-sdk.dev). Respond to @mentions in issue comment threads.

The Linear adapter treats issue comments as messages and issues as threads.

## Installation

```bash
pnpm add @chat-adapter/linear
```

## Usage

The adapter auto-detects credentials from `LINEAR_API_KEY`, `LINEAR_ACCESS_TOKEN`, `LINEAR_CLIENT_CREDENTIALS_CLIENT_ID`/`LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET`, or `LINEAR_CLIENT_ID`/`LINEAR_CLIENT_SECRET`, plus `LINEAR_WEBHOOK_SECRET` and `LINEAR_BOT_USERNAME`:

```typescript
import { Chat } from "chat";
import { createLinearAdapter } from "@chat-adapter/linear";

const bot = new Chat({
  userName: "my-bot",
  adapters: {
    linear: createLinearAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Linear!");
});
```

## Authentication

### Option A: Personal API key

Best for personal projects, testing, or single-workspace bots. Actions are attributed to you as an individual.

1. Go to [Settings > Security & Access](https://linear.app/settings/account/security)
2. Under **Personal API keys**, click **Create key**
3. Select **Only select permissions** and enable Create issues, Create comments
4. Choose team access
5. Click **Create** and set `LINEAR_API_KEY`

```typescript
createLinearAdapter({
  apiKey: process.env.LINEAR_API_KEY!,
});
```

### Option B: Pre-obtained OAuth access token

Use this when your app already manages the OAuth flow and you just want the adapter to operate with a single workspace token.

```typescript
createLinearAdapter({
  accessToken: process.env.LINEAR_ACCESS_TOKEN!,
});
```

### Option C: Multi-tenant OAuth installs

Use top-level `clientId` / `clientSecret` for Slack-style multi-tenant installs. Each Linear workspace installation is stored separately, webhook requests resolve the correct workspace token by `organizationId`, and `withInstallation()` lets you target a specific organization outside webhook handling.

1. Go to [Settings > API > Applications](https://linear.app/settings/api/applications/new)
2. Create an OAuth2 application with your bot's name and icon
4. Note the **Client ID** and **Client Secret**

```typescript
const adapter = createLinearAdapter({
  clientId: process.env.LINEAR_CLIENT_ID!,
  clientSecret: process.env.LINEAR_CLIENT_SECRET!,
});
```

Example callback route:

```typescript
await bot.initialize();
const { organizationId } = await adapter.handleOAuthCallback(request, {
  redirectUri: process.env.LINEAR_REDIRECT_URI!,
});
```

Example background job:

```typescript
await adapter.withInstallation("org-id", async () => {
  await adapter.postMessage("linear:issue-id", "Hello from a background job");
});
```

### Option D: Single-tenant client credentials

If you want app identity without multi-tenant installs, use the explicit `clientCredentials` config. The adapter fetches and refreshes the token automatically.

```typescript
createLinearAdapter({
  clientCredentials: {
    clientId: process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_ID!,
    clientSecret: process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET!,
    scopes: ["read", "write", "comments:create", "issues:create"],
  },
});
```

### Making the bot @-mentionable (optional)

To make the bot appear in Linear's `@` mention dropdown as an Agent:

1. In your OAuth app settings, enable **Agent session events** under webhooks
2. Have a workspace admin install the app with `actor=app` and the `app:mentionable` scope:

```
https://linear.app/oauth/authorize?
  client_id=your_client_id&
  redirect_uri=https://your-domain.com/callback&
  response_type=code&
  scope=read,write,comments:create,issues:create,app:mentionable&
  actor=app
```

If you use single-tenant client credentials, request the same scopes there:

```typescript
createLinearAdapter({
  clientCredentials: {
    clientId: process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_ID!,
    clientSecret: process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET!,
    scopes: [
      "read",
      "write",
      "comments:create",
      "issues:create",
      "app:mentionable",
    ],
  },
});
```

See the [Linear Agents docs](https://linear.app/developers/agents) for full details.

## Webhook setup

> **Note:** Webhook management requires workspace admin access. If you don't see the API settings page, ask a workspace admin to create the webhook for you.

1. Go to **Settings > API** and click **Create webhook**
2. Fill in:
   - **Label**: A descriptive name (e.g., "Chat Bot")
   - **URL**: `https://your-domain.com/api/webhooks/linear`
3. Copy the **Signing secret** as `LINEAR_WEBHOOK_SECRET`
4. Under **Data change events**, select:
   - **Comments** (required)
   - **Issues** (recommended)
   - **Emoji reactions** (optional)
5. Under **Team selection**, choose **All public teams** or a specific team
6. Click **Create webhook**

## Thread model

Linear has two levels of comment threading:

| Type | Description | Thread ID format |
|------|-------------|-----------------|
| Issue-level | Top-level comments on an issue | `linear:{issueId}` |
| Comment thread | Replies nested under a specific comment | `linear:{issueId}:c:{commentId}` |

When a user writes a comment, the bot replies within the same comment thread.

## Reactions

| SDK emoji | Linear emoji |
|-----------|-------------|
| `thumbs_up` | thumbs_up |
| `thumbs_down` | thumbs_down |
| `heart` | heart |
| `fire` | fire |
| `rocket` | rocket |
| `eyes` | eyes |
| `sparkles` | sparkles |
| `wave` | wave |

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `apiKey` | No* | Personal API key. Auto-detected from `LINEAR_API_KEY` |
| `accessToken` | No* | Pre-obtained OAuth access token. Auto-detected from `LINEAR_ACCESS_TOKEN` |
| `clientId` | No* | Multi-tenant OAuth app client ID. Auto-detected from `LINEAR_CLIENT_ID` |
| `clientSecret` | No* | Multi-tenant OAuth app client secret. Auto-detected from `LINEAR_CLIENT_SECRET` |
| `clientCredentials` | No* | Single-tenant client credentials config |
| `clientCredentials.scopes` | No | Scopes for client credentials auth. Defaults to `["read", "write", "comments:create", "issues:create"]` |
| `webhookSecret` | No** | Webhook signing secret. Auto-detected from `LINEAR_WEBHOOK_SECRET` |
| `userName` | No | Bot display name. Auto-detected from `LINEAR_BOT_USERNAME` (default: `"linear-bot"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*One of `apiKey`, `accessToken`, top-level `clientId`/`clientSecret`, or `clientCredentials` is required (via config or env vars).

**`webhookSecret` is required — either via config or `LINEAR_WEBHOOK_SECRET` env var.

## Environment variables

```bash
# API Key auth
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx

# OR pre-obtained access token
LINEAR_ACCESS_TOKEN=lin_oauth_xxxxxxxxxxxx

# OR single-tenant client credentials auth
LINEAR_CLIENT_CREDENTIALS_CLIENT_ID=your-client-id
LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET=your-client-secret
# Optional, comma-separated
LINEAR_CLIENT_CREDENTIALS_SCOPES=read,write,comments:create,issues:create

# OR multi-tenant OAuth installs
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret
LINEAR_REDIRECT_URI=https://your-domain.com/api/linear/install/callback

# Required
LINEAR_WEBHOOK_SECRET=your-webhook-secret
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | No |
| Streaming | No |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Markdown |
| Buttons | No |
| Link buttons | No |
| Select menus | No |
| Tables | GFM |
| Fields | Yes |
| Images in cards | No |
| Modals | No |

### Conversations

| Feature | Supported |
|---------|-----------|
| Slash commands | No |
| Mentions | Yes |
| Add reactions | Yes |
| Remove reactions | Partial |
| Typing indicator | No |
| DMs | No |
| Ephemeral messages | No |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Yes |
| Fetch single message | No |
| Fetch thread info | Yes |
| Fetch channel messages | No |
| List threads | No |
| Fetch channel info | No |
| Post channel message | No |

## Limitations

- **No typing indicators** — Linear doesn't support typing indicators
- **No streaming** — Messages posted in full (editing supported for updates)
- **No DMs** — Linear doesn't have direct messages
- **No modals** — Linear doesn't support interactive modals
- **Action buttons** — Rendered as text; use link buttons for clickable actions
- **Remove reaction** — Requires reaction ID lookup (not directly supported)

## Troubleshooting

### "Invalid signature" error

- Verify `LINEAR_WEBHOOK_SECRET` matches the secret from your webhook configuration
- The webhook secret is shown only once at creation — regenerate if lost

### Bot not responding to mentions

- Verify webhook events are configured with **Comments** resource type
- Check that the webhook URL is correct and accessible
- Ensure the `userName` config matches how users mention the bot
- Linear may auto-disable webhooks after repeated failures

### "Webhook expired" error

- Webhook timestamp is too old (> 5 minutes)
- Usually indicates a delivery delay or clock skew
- Check that your server time is synchronized

## License

MIT
