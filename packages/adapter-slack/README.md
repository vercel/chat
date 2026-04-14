# @chat-adapter/slack

[![npm version](https://img.shields.io/npm/v/@chat-adapter/slack)](https://www.npmjs.com/package/@chat-adapter/slack)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/slack)](https://www.npmjs.com/package/@chat-adapter/slack)

Slack adapter for [Chat SDK](https://chat-sdk.dev). Configure single-workspace or multi-workspace OAuth deployments.

## Installation

```bash
pnpm add @chat-adapter/slack
```

## Single-workspace mode

For bots deployed to a single Slack workspace. The adapter auto-detects `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` from environment variables:

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Slack!");
});
```

## Multi-workspace mode

For apps installed across multiple Slack workspaces via OAuth, omit `botToken` and provide OAuth credentials instead. The adapter resolves tokens dynamically from your state adapter using the `team_id` from incoming webhooks.

When you pass any auth-related config (like `clientId`), the adapter won't fall back to env vars for other auth fields, preventing accidental mixing of auth modes.

```typescript
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

const slackAdapter = createSlackAdapter({
  clientId: process.env.SLACK_CLIENT_ID!,
  clientSecret: process.env.SLACK_CLIENT_SECRET!,
});

const bot = new Chat({
  userName: "mybot",
  adapters: { slack: slackAdapter },
  state: createRedisState(),
});
```

### OAuth callback

The adapter handles the full Slack OAuth V2 exchange. Point your OAuth redirect URL to a route that calls `handleOAuthCallback`:

```typescript
import { slackAdapter } from "@/lib/bot";

export async function GET(request: Request) {
  const { teamId } = await slackAdapter.handleOAuthCallback(request, {
    redirectUri: process.env.SLACK_REDIRECT_URI,
  });
  return new Response(`Installed for team ${teamId}!`);
}
```

If your install flow uses a specific redirect URI, pass the same value here that you used during the authorize step. This is especially useful when one app supports multiple redirect URLs. When no option is provided, the adapter still falls back to `redirect_uri` on the callback request URL.

### Using the adapter outside webhooks

During webhook handling, the adapter resolves tokens automatically from `team_id`. Outside that context (e.g. cron jobs or background workers), use `getInstallation` and `withBotToken`:

```typescript
const install = await slackAdapter.getInstallation(teamId);
if (!install) throw new Error("Workspace not installed");

await slackAdapter.withBotToken(install.botToken, async () => {
  const thread = bot.thread("slack:C12345:1234567890.123456");
  await thread.post("Hello from a cron job!");
});
```

`withBotToken` uses `AsyncLocalStorage` under the hood, so concurrent calls with different tokens are isolated.

### Removing installations

```typescript
await slackAdapter.deleteInstallation(teamId);
```

### Token encryption

Pass a base64-encoded 32-byte key as `encryptionKey` to encrypt bot tokens at rest using AES-256-GCM:

```bash
openssl rand -base64 32
```

When `encryptionKey` is set, `setInstallation()` encrypts the token before storing and `getInstallation()` decrypts it transparently.

## Slack app setup

### 1. Create a Slack app from manifest

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** then **From an app manifest**
3. Select your workspace and paste the following manifest:

```yaml
display_information:
  name: My Bot
  description: A bot built with chat-sdk

features:
  bot_user:
    display_name: My Bot
    always_online: true

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - mpim:history
      - mpim:read
      - reactions:read
      - reactions:write
      - users:read

settings:
  event_subscriptions:
    request_url: https://your-domain.com/api/webhooks/slack
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
      - member_joined_channel
      - assistant_thread_started
      - assistant_thread_context_changed
  interactivity:
    is_enabled: true
    request_url: https://your-domain.com/api/webhooks/slack
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

4. Replace `https://your-domain.com/api/webhooks/slack` with your deployed webhook URL
5. Click **Create**

### 2. Get credentials

After creating the app, go to **Basic Information** → **App Credentials** and copy:

- **Signing Secret** as `SLACK_SIGNING_SECRET`
- **Client ID** as `SLACK_CLIENT_ID` (multi-workspace only)
- **Client Secret** as `SLACK_CLIENT_SECRET` (multi-workspace only)

**Single workspace:** Go to **OAuth & Permissions**, click **Install to Workspace**, and copy the **Bot User OAuth Token** (`xoxb-...`) as `SLACK_BOT_TOKEN`.

**Multi-workspace:** Enable **Manage Distribution** under **Basic Information** and set up an OAuth redirect URL pointing to your callback route.

### 3. Configure slash commands (optional)

1. Go to **Slash Commands** in your app settings
2. Click **Create New Command**
3. Set **Command** (e.g., `/feedback`)
4. Set **Request URL** to `https://your-domain.com/api/webhooks/slack`
5. Add a description and click **Save**

## Configuration

All options are auto-detected from environment variables when not provided. You can call `createSlackAdapter()` with no arguments if the env vars are set.

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | No | Bot token (`xoxb-...`). Auto-detected from `SLACK_BOT_TOKEN` |
| `signingSecret` | No* | Signing secret for webhook verification. Auto-detected from `SLACK_SIGNING_SECRET` |
| `clientId` | No | App client ID for multi-workspace OAuth. Auto-detected from `SLACK_CLIENT_ID` |
| `clientSecret` | No | App client secret for multi-workspace OAuth. Auto-detected from `SLACK_CLIENT_SECRET` |
| `encryptionKey` | No | AES-256-GCM key for encrypting stored tokens. Auto-detected from `SLACK_ENCRYPTION_KEY` |
| `installationKeyPrefix` | No | Prefix for the state key used to store workspace installations. Defaults to `slack:installation`. The full key is `{prefix}:{teamId}` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*`signingSecret` is required — either via config or `SLACK_SIGNING_SECRET` env var.

## Environment variables

```bash
SLACK_BOT_TOKEN=xoxb-...             # Single-workspace only
SLACK_SIGNING_SECRET=...
SLACK_CLIENT_ID=...                  # Multi-workspace only
SLACK_CLIENT_SECRET=...              # Multi-workspace only
SLACK_ENCRYPTION_KEY=...             # Optional, for token encryption
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | Yes |
| Streaming | Native API |
| Scheduled messages | Yes (native, with cancel) |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Block Kit |
| Buttons | Yes |
| Link buttons | Yes |
| Select menus | Yes |
| Tables | Block Kit |
| Fields | Yes |
| Images in cards | Yes |
| Modals | Yes |

### Conversations

| Feature | Supported |
|---------|-----------|
| Slash commands | Yes |
| Mentions | Yes |
| Add reactions | Yes |
| Remove reactions | Yes |
| Typing indicator | Yes |
| DMs | Yes |
| Ephemeral messages | Yes (native) |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Yes |
| Fetch single message | Yes |
| Fetch thread info | Yes |
| Fetch channel messages | Yes |
| List threads | Yes |
| Fetch channel info | Yes |
| Post channel message | Yes |

### Platform-specific

| Feature | Supported |
|---------|-----------|
| Assistants API | Yes |
| Member joined channel | Yes |
| App Home tab | Yes |

## Slack Assistants API

The adapter supports Slack's [Assistants API](https://api.slack.com/docs/apps/ai) for building AI-powered assistant experiences. This enables suggested prompts, status indicators, and thread titles in assistant DM threads.

### Event handlers

Register handlers on the `Chat` instance:

```typescript
bot.onAssistantThreadStarted(async (event) => {
  const slack = bot.getAdapter("slack") as SlackAdapter;
  await slack.setSuggestedPrompts(event.channelId, event.threadTs, [
    { title: "Summarize", message: "Summarize this channel" },
    { title: "Draft", message: "Help me draft a message" },
  ]);
});

bot.onAssistantContextChanged(async (event) => {
  // User navigated to a different channel with the assistant panel open
});
```

### Adapter methods

The `SlackAdapter` exposes these methods for the Assistants API:

| Method | Description |
|--------|-------------|
| `setSuggestedPrompts(channelId, threadTs, prompts, title?)` | Show prompt suggestions in the thread |
| `setAssistantStatus(channelId, threadTs, status)` | Show a thinking/status indicator |
| `setAssistantTitle(channelId, threadTs, title)` | Set the thread title (shown in History) |
| `publishHomeView(userId, view)` | Publish a Home tab view for a user |
| `startTyping(threadId, status)` | Show a custom loading status (requires `assistant:write` scope) |

### Required scopes and events

Add these to your Slack app manifest for Assistants API support:

```yaml
oauth_config:
  scopes:
    bot:
      - assistant:write

settings:
  event_subscriptions:
    bot_events:
      - assistant_thread_started
      - assistant_thread_context_changed
```

### Stream with stop blocks

When streaming in an assistant thread, you can attach Block Kit elements to the final message:

```typescript
await thread.stream(textStream, {
  stopBlocks: [
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Retry" }, action_id: "retry" }] },
  ],
});
```

## Troubleshooting

### `handleOAuthCallback` throws "Adapter not initialized"

- Call `await bot.initialize()` before `handleOAuthCallback()` in your callback route.
- In a Next.js app, this ensures:
  - state adapter is connected
  - the Slack adapter is attached to Chat
  - installation writes succeed

```typescript
const slackAdapter = bot.getAdapter("slack");

await bot.initialize();
await slackAdapter.handleOAuthCallback(request);
```

### "Invalid signature" error

- Verify `SLACK_SIGNING_SECRET` is correct
- Check that the request timestamp is within 5 minutes (clock sync issue)

### Bot not responding to messages

- Verify event subscriptions are configured
- Check that the bot has been added to the channel
- Ensure the webhook URL is correct and accessible

## License

MIT
