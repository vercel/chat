[![Linear adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/linear/og)](https://chat-sdk.dev/adapters/official/linear)

# @chat-adapter/linear

> npm package: [`@chat-adapter/linear`](https://www.npmjs.com/package/@chat-adapter/linear)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Linear adapter for [Chat SDK](https://chat-sdk.dev). Respond to @mentions in issue comment threads and Linear app-actor agent sessions.

The Linear adapter treats issue comments as messages and issues as threads.

Documentation: [chat-sdk.dev/adapters/official/linear](https://chat-sdk.dev/adapters/official/linear) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/linear
```

## Scaffold with the CLI

To scaffold a new Linear bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter linear memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

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

By default, the adapter runs in `mode: "comments"` and treats `Comment` webhooks as the inbound message source. For Linear app-actor installs, set `mode: "agent-sessions"` so inbound handling is driven by `AgentSessionEvent`.

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
  mode: "agent-sessions",
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
  mode: "agent-sessions",
});
```

### Option E: Vercel Connect

Use [Vercel Connect](https://vercel.com/docs/connect) to source the Linear access token at runtime instead of storing a long-lived token or OAuth secret. Pass `accessToken` as a resolver and verify inbound webhooks with `webhookVerifier` (a Vercel OIDC token from Connect trigger forwarding) instead of a webhook secret.

The simplest path is the `connectLinearAdapter()` helper from [`@vercel/connect/chat`](https://www.npmjs.com/package/@vercel/connect):

```typescript
import { createLinearAdapter } from "@chat-adapter/linear";
import { connectLinearAdapter } from "@vercel/connect/chat";

createLinearAdapter({
  ...connectLinearAdapter("linear/acme-linear"),
  mode: "agent-sessions",
});
```

Or wire the fields yourself:

```typescript
import { getToken } from "@vercel/connect";

createLinearAdapter({
  accessToken: () =>
    getToken("linear/acme-linear", { subject: { type: "app" } }),
  webhookVerifier: myConnectWebhookVerifier,
  mode: "agent-sessions",
});
```

`accessToken` accepts a `string` or `() => string | Promise<string>` resolver invoked per API call, so it composes with Connect's short-lived tokens. When `webhookVerifier` is set it takes precedence over `webhookSecret` and `LINEAR_WEBHOOK_SECRET`.

> **Freshness:** OIDC verification replaces Linear's signature + timestamp check, so request freshness relies on the short-lived OIDC token's expiry rather than the `>5 min` timestamp rejection, and there is no built-in delivery de-duplication. Keep your webhook handlers idempotent (Linear can also deliver events out of order).

### Token encryption

For multi-tenant OAuth installs, pass a base64-encoded 32-byte key as `encryptionKey` (or set `LINEAR_ENCRYPTION_KEY`) to encrypt stored access and refresh tokens at rest using AES-256-GCM:

```bash
openssl rand -base64 32
```

When `encryptionKey` is set, `setInstallation()` encrypts tokens before writing them to the configured state adapter and `getInstallation()` decrypts them transparently. Existing plaintext records continue to work, so you can roll the key in without flushing installs. Without an `encryptionKey`, tokens are stored in plaintext (the previous default).

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

Once installed with `actor=app`, set `mode: "agent-sessions"` so the adapter treats `AgentSessionEvent` as the entrypoint for mentions:

- `onNewMention` fires from the session-created event
- `thread.startTyping()` sends an ephemeral Linear `thought`
- `thread.post(stream)` uses agent activities and session plan updates
- Session threads are append-only, so `sent.edit()` / `sent.delete()` are not supported there

See the [Linear Agents docs](https://linear.app/developers/agents) for full details.

## Direct API client

For anything beyond the unified SDK, access the underlying [LinearClient](https://github.com/linear/linear/tree/master/packages/sdk) via `.linearClient`:

```typescript
const linear = bot.getAdapter("linear").linearClient;

const issue = await linear.issue("ENG-123");
const project = await issue.project;
```

API key, access token, and single-tenant client-credentials modes return the same client anywhere. Multi-tenant OAuth mode requires webhook handler context to resolve the per-org token — calling `.linearClient` outside a handler throws.

> The previous `.client` getter still works as a deprecated alias for `.linearClient`.

## Webhook setup

> **Note:** Webhook management requires workspace admin access. If you don't see the API settings page, ask a workspace admin to create the webhook for you.

1. Go to **Settings > API** and click **Create webhook**
2. Fill in:
   - **Label**: A descriptive name (e.g., "Chat Bot")
   - **URL**: `https://your-domain.com/api/webhooks/linear`
3. Copy the **Signing secret** as `LINEAR_WEBHOOK_SECRET`
4. Under **Data change events**, select:
   - **Comments** (required for `mode: "comments"`)
   - **Agent session events** (required for `mode: "agent-sessions"`)
   - **Issues** (recommended)
   - **Emoji reactions** (optional)
5. Under **Team selection**, choose **All public teams** or a specific team
6. Click **Create webhook**

## Thread model

Linear has four thread variants:

| Type | Description | Thread ID format |
|------|-------------|-----------------|
| Issue-level | Top-level comments on an issue | `linear:{issueId}` |
| Comment thread | Replies nested under a specific comment | `linear:{issueId}:c:{commentId}` |
| Agent session on issue | App-actor session attached to an issue | `linear:{issueId}:s:{agentSessionId}` |
| Agent session on comment thread | App-actor session attached to a comment thread | `linear:{issueId}:c:{commentId}:s:{agentSessionId}` |

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
| `accessToken` | No* | OAuth access token. Accepts a string, or (Vercel Connect) a `() => string \| Promise<string>` resolver invoked per API call. Auto-detected from `LINEAR_ACCESS_TOKEN` |
| `clientId` | No* | Multi-tenant OAuth app client ID. Auto-detected from `LINEAR_CLIENT_ID` |
| `clientSecret` | No* | Multi-tenant OAuth app client secret. Auto-detected from `LINEAR_CLIENT_SECRET` |
| `encryptionKey` | No | AES-256-GCM key for encrypting stored OAuth tokens. Auto-detected from `LINEAR_ENCRYPTION_KEY` |
| `clientCredentials` | No* | Single-tenant client credentials config |
| `clientCredentials.scopes` | No | Scopes for client credentials auth. Defaults to `["read", "write", "comments:create", "issues:create"]` |
| `mode` | No | Inbound webhook handling mode. `"comments"` by default, or `"agent-sessions"` for app-actor installs |
| `webhookSecret` | No** | Webhook signing secret. Auto-detected from `LINEAR_WEBHOOK_SECRET` |
| `webhookVerifier` | No** | Custom verifier `(request, body) => unknown \| Promise<unknown>` used in place of `webhookSecret`. Takes precedence over `webhookSecret`/`LINEAR_WEBHOOK_SECRET`. Required in Connect mode |
| `userName` | No | Bot display name. Auto-detected from `LINEAR_BOT_USERNAME` (default: `"linear-bot"`) |
| `apiUrl` | No | Override the Linear GraphQL API base URL. Auto-detected from `LINEAR_API_URL` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*One of `apiKey`, `accessToken` (string or Vercel Connect resolver), top-level `clientId`/`clientSecret`, or `clientCredentials` is required (via config or env vars).

**Either `webhookSecret` (via config or `LINEAR_WEBHOOK_SECRET`) or a `webhookVerifier` is required. When `webhookVerifier` is set it takes precedence and the secret is ignored.

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
# Optional: encrypt stored OAuth tokens at rest
LINEAR_ENCRYPTION_KEY=...

# Optional: inbound webhook mode
# comments | agent-sessions
LINEAR_MODE=comments

# Required
LINEAR_WEBHOOK_SECRET=your-webhook-secret

# Optional: override the Linear GraphQL API base URL
LINEAR_API_URL=...
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Partial |
| Delete message | Partial |
| File uploads | No |
| Streaming | Agent sessions / Post+Edit fallback |

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
| Typing indicator | Agent sessions only |
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

- **Comment threads are still comment-based** — typing indicators and native streaming only exist for app-actor agent sessions
- **Agent session threads are append-only** — `editMessage` and `deleteMessage` work for normal comments, but not for session activities
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
- For app-actor mode, also enable **Agent session events**
- Check that the webhook URL is correct and accessible
- Ensure the `userName` config matches how users mention the bot
- If using app-actor installs, ensure the app was installed with `actor=app` and `app:mentionable`
- Linear may auto-disable webhooks after repeated failures

### "Webhook expired" error

- Webhook timestamp is too old (> 5 minutes)
- Usually indicates a delivery delay or clock skew
- Check that your server time is synchronized

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
