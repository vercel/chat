# @chat-adapter/linear

Linear adapter for the [chat](https://github.com/vercel-labs/chat) SDK. Enables bots to respond to @mentions in Linear issue comment threads.

## Installation

```bash
npm install chat @chat-adapter/linear
```

## Usage

```typescript
import { Chat } from "chat";
import { createLinearAdapter } from "@chat-adapter/linear";
import { MemoryState } from "@chat-adapter/state-memory";

const chat = new Chat({
  userName: "my-bot",
  adapters: {
    linear: createLinearAdapter({
      apiKey: process.env.LINEAR_API_KEY!,
      webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
      userName: "my-bot",
      logger: console,
    }),
  },
  state: new MemoryState(),
  logger: "info",
});

// Handle @mentions in issue comments
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Linear!");
});
```

## Configuration

| Option          | Required | Description                                                                                         |
| --------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `apiKey`        | Yes\*    | [Personal API key](https://linear.app/docs/api-and-webhooks) from Settings > Security & Access      |
| `clientId`      | Yes\*    | [OAuth app](https://linear.app/developers/oauth-2-0-authentication) client ID                       |
| `clientSecret`  | Yes\*    | OAuth app client secret                                                                             |
| `accessToken`   | Yes\*    | Pre-obtained [OAuth access token](https://linear.app/developers/oauth-2-0-authentication)           |
| `webhookSecret` | Yes      | [Webhook signing secret](https://linear.app/developers/webhooks#securing-webhooks) for verification |
| `userName`      | Yes      | Bot display name for @mention detection                                                             |

\*One of: `apiKey`, `clientId`/`clientSecret`, or `accessToken` is required.

## Environment Variables

```bash
# API Key auth (simplest)
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx

# OR OAuth app auth (recommended for production)
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret

# Webhook secret (required for all auth methods)
LINEAR_WEBHOOK_SECRET=your-webhook-secret
```

## Linear Setup

### Option A: Personal API Key

Best for personal projects, testing, or single-workspace bots.

1. Go to [Settings > Security & Access](https://linear.app/settings/account/security) in Linear
2. Scroll to **Personal API keys** and click **Create key**
3. Select **Only select permissions** and enable:
   - **Create issues** - Create and update issues
   - **Create comments** - Create and update issue comments
4. Under **Team access**, choose **All teams** or select specific teams
5. Click **Create** and set `LINEAR_API_KEY` environment variable

> **Note:** When using a personal API key, all actions are attributed to you as an individual.

### Option B: OAuth Application (Recommended for Apps)

Use this if you want the bot to have its **own identity** in Linear (not attributed to you personally), or if you're building a public integration. The adapter handles token management internally -- no need to store tokens.

1. Go to [Settings > API > Applications](https://linear.app/settings/api/applications/new) in Linear
2. Create a new OAuth2 application with your bot's name and icon
3. **Enable client credentials tokens** in the app settings
4. Note your **Client ID** and **Client Secret**
5. Set `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` environment variables

```typescript
createLinearAdapter({
  clientId: process.env.LINEAR_CLIENT_ID!,
  clientSecret: process.env.LINEAR_CLIENT_SECRET!,
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
  userName: "my-bot",
  logger: console,
});
```

The adapter uses the [client credentials grant](https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens) to obtain tokens automatically. Tokens are valid for 30 days and auto-refresh when expired.

> **When to use which?**
>
> - **API Key** -- Personal projects, testing, single workspace. Actions attributed to you.
> - **OAuth App** -- Production bots, public integrations, bot has its own identity.
> - For making the bot `@`-mentionable as an [Agent](https://linear.app/developers/agents), see the [OAuth setup guide](#oauth-setup-guide) below.

### Webhook Setup

See the [Linear Webhooks documentation](https://linear.app/developers/webhooks) for detailed instructions.

> **Note:** Webhook management requires **workspace admin** access. If you don't see the API settings page, ask a workspace admin to create the webhook for you.

1. Go to **Settings > API** in your Linear workspace and click **Create webhook**
2. Fill in:
   - **Label**: A descriptive name (e.g., "Chat Bot")
   - **URL**: `https://your-domain.com/api/webhooks/linear`
3. Copy the **Signing secret** and set it as `LINEAR_WEBHOOK_SECRET`
4. Under **Data change events**, select:
   - **Comments** (required - for issue comments)
   - **Issues** (recommended - for mentions in issue descriptions)
   - **Emoji reactions** (optional - for reaction handling)
5. Under **Team selection**, choose **All public teams** or a specific team
6. Click **Create webhook**

## Features

- Message posting and editing
- Message deletion
- [Reaction handling](https://linear.app/docs/comment-on-issues) (add reactions via emoji)
- Issue comment threads
- Cards (rendered as [Markdown](https://linear.app/docs/comment-on-issues))

## Thread Model

Linear has two levels of comment threading:

| Type           | Description                             | Thread ID Format                 |
| -------------- | --------------------------------------- | -------------------------------- |
| Issue-level    | Top-level comments on an issue          | `linear:{issueId}`               |
| Comment thread | Replies nested under a specific comment | `linear:{issueId}:c:{commentId}` |

When a user writes a comment, the bot replies **within the same comment thread** (nested under the same card). This matches the expected Linear UX where conversations are grouped.

Example thread IDs:

- `linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9` (issue-level)
- `linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9:c:comment-abc123` (comment thread)

## Reactions

Linear supports standard [emoji reactions](https://linear.app/docs/comment-on-issues) on comments. The adapter maps SDK emoji names to unicode:

| SDK Emoji     | Linear Emoji |
| ------------- | ------------ |
| `thumbs_up`   | 👍           |
| `thumbs_down` | 👎           |
| `heart`       | ❤️           |
| `fire`        | 🔥           |
| `rocket`      | 🚀           |
| `eyes`        | 👀           |
| `sparkles`    | ✨           |
| `wave`        | 👋           |

## Limitations

- **No typing indicators** - Linear doesn't support typing indicators
- **No streaming** - Messages posted in full (editing supported for updates)
- **No DMs** - Linear doesn't have direct messages
- **No modals** - Linear doesn't support interactive modals
- **Action buttons** - Rendered as text; use link buttons for clickable actions
- **Remove reaction** - Requires reaction ID lookup (not directly supported)

## Troubleshooting

### "Invalid signature" error

- Verify `LINEAR_WEBHOOK_SECRET` matches the secret from your webhook configuration
- Ensure the request body isn't being modified before verification
- The webhook secret is shown only once at creation - regenerate if lost

### Bot not responding to mentions

- Verify webhook events are configured with `Comment` resource type
- Check that the webhook URL is correct and accessible
- Ensure the `userName` config matches how users mention the bot
- Check that the webhook is enabled (Linear may auto-disable after repeated failures)

### "Webhook expired" error

- This means the webhook timestamp is too old (> 5 minutes)
- Usually indicates a delivery delay or clock skew
- Check that your server time is synchronized

### Rate limiting

- Linear API has [rate limits](https://linear.app/developers/graphql#rate-limiting)
- The SDK handles rate limiting automatically in most cases

## OAuth Setup Guide

This section is only relevant if you chose [Option B: OAuth Application](#option-b-oauth-application-recommended-for-apps). If you're using a personal API key (Option A), you can skip this entirely.

Setting up an OAuth application gives the bot its own identity in Linear rather than acting as your personal account.

### 1. Create the OAuth Application

1. Go to [Settings > API > Applications](https://linear.app/settings/api/applications/new) in Linear (requires admin)
2. Fill in:
   - **Application name**: Your bot's name (e.g., "v0") -- this is how it appears in Linear
   - **Application icon**: Upload an icon for the bot
   - **Redirect callback URLs**: Add a placeholder URL (e.g., `https://your-domain.com/callback`) -- not needed for client credentials auth
3. Click **Create**
4. **Enable client credentials tokens** in the app settings
5. Note your **Client ID** and **Client Secret**

### 2. Configure the Adapter

```typescript
createLinearAdapter({
  clientId: process.env.LINEAR_CLIENT_ID!,
  clientSecret: process.env.LINEAR_CLIENT_SECRET!,
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
  userName: "v0",
  logger: console,
});
```

That's it. The adapter automatically obtains and refreshes tokens using the [client credentials grant](https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens). No callback endpoints, no token storage, no refresh logic on your end.

### 3. Making the Bot @-Mentionable (Optional)

To make the bot appear in Linear's `@` mention dropdown as an [Agent](https://linear.app/developers/agents):

1. In your OAuth app settings, enable **Agent session events** under webhooks
2. Have a workspace admin install the app using `actor=app` with the `app:mentionable` scope:

```
https://linear.app/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=https://your-domain.com/callback&
  response_type=code&
  scope=read,write,comments:create,app:mentionable&
  actor=app
```

Once installed, the bot shows up as a mentionable user in the workspace. See the [Linear Agents docs](https://linear.app/developers/agents) for full details.

For more on Linear OAuth, see the [Linear OAuth 2.0 documentation](https://linear.app/developers/oauth-2-0-authentication).

## License

MIT
