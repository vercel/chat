# @chat-adapter/slack

Slack adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/slack
```

## Usage (Single Workspace)

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Slack!");
});
```

## Multi-Workspace Mode

For apps installed across multiple Slack workspaces, omit `botToken` and let the adapter resolve tokens dynamically from your state adapter (e.g. Redis) using the `team_id` from incoming webhooks.

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

const slackAdapter = createSlackAdapter({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  clientId: process.env.SLACK_CLIENT_ID!,
  clientSecret: process.env.SLACK_CLIENT_SECRET!,
  logger: logger,
  encryptionKey: process.env.SLACK_ENCRYPTION_KEY, // optional, encrypts tokens at rest
});

const chat = new Chat({
  userName: "mybot",
  adapters: { slack: slackAdapter },
  state: createRedisState({ url: process.env.REDIS_URL! }),
  // notice that there is no bot token
});
```

### OAuth callback

The adapter handles the full Slack OAuth V2 exchange. Pass `clientId` and `clientSecret` in the config, then point your OAuth redirect URL to a route that calls `handleOAuthCallback`:

```typescript
import { slackAdapter } from "@/lib/chat"; // your adapter instance

export async function GET(request: Request) {
  const { teamId } = await slackAdapter.handleOAuthCallback(request);
  return new Response(`Installed for team ${teamId}!`);
}
```

### Webhook handling

No changes needed — the adapter extracts `team_id` from incoming webhooks and resolves the token automatically:

```typescript
export async function POST(request: Request) {
  return chat.webhooks.slack(request, { waitUntil });
}
```

### Using the adapter outside a webhook (cron jobs, workflows)

During webhook handling, the adapter resolves the token automatically from `team_id`. Outside that context (e.g. a cron job), use `getInstallation` to retrieve the token and `withBotToken` to scope it:

```typescript
import { Chat } from "chat";

// In a cron job or background worker:
const install = await slackAdapter.getInstallation(teamId);
if (!install) throw new Error("Workspace not installed");

await slackAdapter.withBotToken(install.botToken, async () => {
  // All adapter calls inside this callback use the provided token.
  // You can use thread.post(), thread.subscribe(), etc. normally.
  const thread = chat.thread("slack:C12345:1234567890.123456");
  await thread.post("Hello from a cron job!");
});
```

`withBotToken` uses `AsyncLocalStorage` under the hood, so concurrent calls with different tokens are isolated from each other.

### Removing installations

```typescript
await slackAdapter.deleteInstallation(teamId);
```

### Encryption

Pass a base64-encoded 32-byte key as `encryptionKey` to encrypt bot tokens at rest using AES-256-GCM. You can generate a key with:

```bash
openssl rand -base64 32
```

When `encryptionKey` is set, `setInstallation()` encrypts the token before storing it and `getInstallation()` decrypts it transparently.

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | No | Slack bot token (`xoxb-...`). Required for single-workspace mode. Omit for multi-workspace. |
| `signingSecret` | Yes | Slack signing secret for webhook verification |
| `clientId` | No | Slack app client ID (required for OAuth / multi-workspace) |
| `clientSecret` | No | Slack app client secret (required for OAuth / multi-workspace) |
| `encryptionKey` | No | Base64-encoded 32-byte AES-256-GCM key for encrypting stored tokens |

## Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-...           # single-workspace only
SLACK_SIGNING_SECRET=...
SLACK_CLIENT_ID=...                # required for multi-workspace OAuth
SLACK_CLIENT_SECRET=...            # required for multi-workspace OAuth
SLACK_ENCRYPTION_KEY=...           # optional, for multi-workspace token encryption
```

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Enter app name and select workspace
4. Click **Create App**

### 2. Configure Bot Token Scopes

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `app_mentions:read` - Receive @mention events
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info
   - `chat:write` - Send messages
   - `groups:history` - Read messages in private channels
   - `groups:read` - View basic private channel info
   - `im:history` - Read direct messages
   - `im:read` - View basic DM info
   - `reactions:read` - View emoji reactions
   - `reactions:write` - Add/remove emoji reactions
   - `users:read` - View user info (for display names)

### 3. Install App to Workspace

**Single workspace:** Install directly from the Slack dashboard.

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Authorize the app
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → `SLACK_BOT_TOKEN`

**Multi-workspace:** Enable **Manage Distribution** under **Basic Information**, then set up an [OAuth redirect URL](https://api.slack.com/authentication/oauth-v2) pointing to your callback route. The adapter handles the token exchange via `handleOAuthCallback()` (see [Multi-Workspace Mode](#multi-workspace-mode) above).

### 4. Get Signing Secret and OAuth Credentials

1. Go to **Basic Information**
2. Under **App Credentials**, copy:
   - **Signing Secret** → `SLACK_SIGNING_SECRET`
   - **Client ID** → `SLACK_CLIENT_ID` (multi-workspace only)
   - **Client Secret** → `SLACK_CLIENT_SECRET` (multi-workspace only)

### 5. Configure Event Subscriptions

1. Go to **Event Subscriptions**
2. Toggle **Enable Events** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack`
   - Slack will verify the URL immediately
4. Under **Subscribe to bot events**, add:
   - `app_mention` - When someone @mentions your bot
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
5. Click **Save Changes**

### 6. (Optional) Enable Interactivity

If you want to use buttons, modals, or other interactive components:

1. Go to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack`

## Features

- Multi-workspace support with OAuth V2 and encrypted token storage
- Message posting and editing
- Thread subscriptions
- Reaction handling (add/remove/events)
- File attachments
- Rich cards (Block Kit)
- Action callbacks (interactive components)
- Direct messages

## Troubleshooting

### "Invalid signature" error
- Verify `SLACK_SIGNING_SECRET` is correct
- Check that the request timestamp is within 5 minutes (clock sync issue)

### Bot not responding to messages
- Verify Event Subscriptions are configured
- Check that the bot has been added to the channel
- Ensure the webhook URL is correct and accessible

## License

MIT
