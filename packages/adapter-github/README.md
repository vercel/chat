[![GitHub adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/github/og)](https://chat-sdk.dev/adapters/official/github)

# @chat-adapter/github

> npm package: [`@chat-adapter/github`](https://www.npmjs.com/package/@chat-adapter/github)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

GitHub adapter for [Chat SDK](https://chat-sdk.dev). Respond to @mentions in PR and issue comment threads.

The GitHub adapter treats issue and pull request comments as messages, and issues/PRs as threads.

Documentation: [chat-sdk.dev/adapters/official/github](https://chat-sdk.dev/adapters/official/github) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/github
```

## Scaffold with the CLI

To scaffold a new GitHub bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter github memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

The adapter auto-detects credentials from `GITHUB_TOKEN` (or `GITHUB_APP_ID`/`GITHUB_PRIVATE_KEY`), `GITHUB_WEBHOOK_SECRET`, and `GITHUB_BOT_USERNAME` environment variables:

```typescript
import { Chat } from "chat";
import { createGitHubAdapter } from "@chat-adapter/github";

const bot = new Chat({
  userName: "my-bot",
  adapters: {
    github: createGitHubAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from GitHub!");
});
```

## Authentication

### Option A: Personal Access Token

Best for personal projects, testing, or single-repo bots.

1. Go to [Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Create a new token with `repo` scope
3. Set `GITHUB_TOKEN` environment variable

```typescript
createGitHubAdapter({
  token: process.env.GITHUB_TOKEN!,
});
```

### Option B: GitHub App (recommended)

Better rate limits, security, and supports multiple installations.

**1. Create the app:**

1. Go to [Settings > Developer settings > GitHub Apps > New GitHub App](https://github.com/settings/apps/new)
2. Set **Webhook URL** to `https://your-domain.com/api/webhooks/github`
3. Generate and set a **Webhook secret**
4. Set permissions:
   - Repository > Issues: Read & write
   - Repository > Pull requests: Read & write
   - Repository > Metadata: Read-only
5. Subscribe to events: Issue comment, Pull request review comment
6. Click **Create GitHub App**
7. Note the **App ID** and click **Generate a private key**

**2. Install the app:**

1. Go to your app's settings then **Install App**
2. Click **Install** and choose repositories
3. Note the **Installation ID** from the URL:
   ```
   https://github.com/settings/installations/12345678
                                              ^^^^^^^^
   ```

**Single-tenant:**

```typescript
createGitHubAdapter({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_PRIVATE_KEY!,
  installationId: parseInt(process.env.GITHUB_INSTALLATION_ID!),
});
```

**Multi-tenant (omit `installationId`):**

```typescript
createGitHubAdapter({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_PRIVATE_KEY!,
});
```

The adapter automatically extracts installation IDs from webhooks and caches API clients per-installation.

### Option C: Vercel Connect

Use [Vercel Connect](https://vercel.com/docs/connect) to source installation access tokens at runtime instead of storing a GitHub App private key. The `installationToken` resolver supplies the token the adapter sends directly (skipping the App JWT exchange), and `webhookVerifier` verifies Connect trigger-forwarded webhooks via a Vercel OIDC token instead of a webhook secret.

The simplest path is the `connectGitHubAdapter()` helper from [`@vercel/connect/chat`](https://www.npmjs.com/package/@vercel/connect):

```typescript
import { createGitHubAdapter } from "@chat-adapter/github";
import { connectGitHubAdapter } from "@vercel/connect/chat";

createGitHubAdapter({
  ...connectGitHubAdapter("github/acme-github"),
  userName: "my-bot[bot]",
});
```

Or wire the fields yourself:

```typescript
import { getToken } from "@vercel/connect";

createGitHubAdapter({
  installationToken: () =>
    getToken("github/acme-github", { subject: { type: "app" } }),
  webhookVerifier: myConnectWebhookVerifier,
  userName: "my-bot[bot]",
});
```

`installationToken` accepts a `string` or `() => string | Promise<string>` resolver invoked per API call, so it composes with Connect's short-lived tokens. When `webhookVerifier` is set it takes precedence over `webhookSecret` and `GITHUB_WEBHOOK_SECRET`.

> **Freshness:** OIDC verification replaces GitHub's signature check, so request freshness relies on the short-lived OIDC token's expiry rather than a signed timestamp, and there is no built-in nonce/delivery-id de-duplication. Keep your webhook handlers idempotent (GitHub may also redeliver events).

> **Set `botUserId` for self-message detection.** In Connect mode the adapter only holds an installation token, so it can't auto-detect its own bot user id (the `/app` lookup needs the App's JWT). Without it, the adapter can't tell its own comments apart from users' and will reply to itself in a loop. The adapter learns the id from the first comment it posts, but that lives in memory — on serverless (where each webhook may hit a fresh instance) that isn't enough. Pass `botUserId` (the numeric id of your `…[bot]` user) so every instance knows it up front:
>
> ```typescript
> createGitHubAdapter({
>   ...connectGitHubAdapter("github/acme-github"),
>   botUserId: 12345678, // id of your-app[bot]
> });
> ```
>
> Or set the `GITHUB_BOT_USER_ID` environment variable, which the adapter auto-detects. Find the id (no auth needed) with `curl -s 'https://api.github.com/users/your-app%5Bbot%5D'`.

## Installation lookup

You can resolve the GitHub App installation ID associated with a `Thread` or `Message`:

```typescript
import { Chat } from "chat";
import { createGitHubAdapter } from "@chat-adapter/github";

const github = createGitHubAdapter({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_PRIVATE_KEY!,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
});

const bot = new Chat({
  adapters: { github },
});

bot.onNewMention(async (thread, message) => {
  const installationIdFromThread = await github.getInstallationId(thread);
  const installationIdFromMessage = await github.getInstallationId(message.threadId);

  await thread.post(
    `Thread install: ${installationIdFromThread}, message install: ${installationIdFromMessage}`
  );
});
```

- Single-tenant GitHub App mode returns the fixed configured installation ID.
- PAT mode returns `undefined`.
- Multi-tenant mode only succeeds after the adapter has received a webhook for that repository and cached the installation mapping. Use a persistent state adapter so the mapping survives restarts.

## Direct API client

For anything beyond the unified SDK, access the underlying [Octokit](https://github.com/octokit/octokit.js) instance via `.octokit`:

```typescript
const github = bot.getAdapter("github").octokit;

const { data: pulls } = await github.rest.pulls.list({
  owner: "vercel",
  repo: "chat",
  state: "open",
});
```

PAT and single-tenant GitHub App modes (with a fixed `installationId`) return the same client anywhere. Multi-tenant mode requires webhook handler context to resolve the right installation — calling `.octokit` outside a handler throws.

> The previous `.client` getter still works as a deprecated alias for `.octokit`.

## Webhook setup

For repository or organization webhooks:

1. Go to repository/org **Settings** then **Webhooks** then **Add webhook**
2. Set **Payload URL** to `https://your-domain.com/api/webhooks/github`
3. Set **Content type** to `application/json` (required — the default `application/x-www-form-urlencoded` does not work)
4. Set **Secret** to match your `webhookSecret`
5. Select events: Issue comments, Pull request review comments

> **Warning:** GitHub App webhooks are configured during app creation. Make sure to select `application/json` as the content type.

## Thread model

GitHub has three types of comment threads:

| Type | Context | Thread ID format |
|------|---------|-----------------|
| PR-level | PR Conversation tab | `github:{owner}/{repo}:{prNumber}` |
| Review comments | PR Files Changed tab | `github:{owner}/{repo}:{prNumber}:rc:{commentId}` |
| Issue comments | Issue thread | `github:{owner}/{repo}:issue:{issueNumber}` |

## Reactions

Supports GitHub's reaction emoji:

| SDK emoji | GitHub reaction |
|-----------|----------------|
| `thumbs_up` | +1 |
| `thumbs_down` | -1 |
| `laugh` | laugh |
| `confused` | confused |
| `heart` | heart |
| `hooray` | hooray |
| `rocket` | rocket |
| `eyes` | eyes |

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `token` | No* | Personal Access Token. Auto-detected from `GITHUB_TOKEN` |
| `appId` | No* | GitHub App ID. Auto-detected from `GITHUB_APP_ID` |
| `privateKey` | No | GitHub App private key (PEM). Auto-detected from `GITHUB_PRIVATE_KEY` |
| `installationId` | No | Installation ID (omit for multi-tenant). Auto-detected from `GITHUB_INSTALLATION_ID` |
| `installationToken` | No* | Vercel Connect mode: installation access token, or a `() => string \| Promise<string>` resolver invoked per API call. Skips the App JWT exchange. |
| `webhookSecret` | No** | Webhook secret. Auto-detected from `GITHUB_WEBHOOK_SECRET` |
| `webhookVerifier` | No** | Custom verifier `(request, body) => unknown \| Promise<unknown>` used in place of `webhookSecret`. Takes precedence over `webhookSecret`/`GITHUB_WEBHOOK_SECRET`. Required in Connect mode |
| `userName` | No | Bot username for @mention detection. Auto-detected from `GITHUB_BOT_USERNAME` (default: `"github-bot"`) |
| `botUserId` | No | Bot's numeric user ID (auto-detected if not provided) |
| `apiUrl` | No | Override the GitHub API base URL (e.g. for GitHub Enterprise Server). Auto-detected from `GITHUB_API_URL` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*One of `token`/`GITHUB_TOKEN`, `appId`+`privateKey`/`GITHUB_APP_ID`+`GITHUB_PRIVATE_KEY`, or `installationToken` (Vercel Connect) is required.

**Either `webhookSecret` (via config or `GITHUB_WEBHOOK_SECRET`) or a `webhookVerifier` is required. When `webhookVerifier` is set it takes precedence and the secret is ignored.

## Environment variables

```bash
# Personal Access Token auth
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# OR GitHub App auth
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_INSTALLATION_ID=12345678  # Optional for multi-tenant

# Required
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Optional: GitHub Enterprise Server
GITHUB_API_URL=https://github.example.com/api/v3
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | No |
| Streaming | Buffered (accumulates then sends) |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | GFM Markdown |
| Buttons | No |
| Link buttons | No |
| Select menus | No |
| Tables | GFM |
| Fields | Yes |
| Images in cards | Yes |
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
| Fetch channel messages | Yes |
| List threads | Yes |
| Fetch channel info | Yes |
| Post channel message | No |

### Platform-specific

| Feature | Supported |
|---------|-----------|
| Multi-tenant | Yes (GitHub App) |

## Limitations

- **No typing indicators** — GitHub doesn't support typing indicators
- **No streaming** — Messages posted in full (editing supported for updates)
- **No DMs** — GitHub doesn't have direct messages
- **No modals** — GitHub doesn't support interactive modals
- **Action buttons** — Rendered as text; use link buttons for clickable actions

## Troubleshooting

### "Invalid signature" error

- Verify `GITHUB_WEBHOOK_SECRET` matches your webhook configuration
- Ensure the request body isn't modified before verification

### "Invalid JSON" error

- Change webhook **Content type** to `application/json`

### Bot not responding to mentions

- Verify webhook events are configured (issue_comment, pull_request_review_comment)
- Check the webhook URL is correct and accessible
- Ensure the `userName` config matches your bot's GitHub username

### "Installation ID required" error

- This occurs when making API calls outside webhook context in multi-tenant mode
- Use a persistent state adapter (Redis) to store installation mappings
- The first interaction must come from a webhook to establish the mapping

### Rate limiting

- PATs have lower rate limits than GitHub Apps
- Consider switching to a GitHub App for production use

## Resources

- [Ship a GitHub code review bot with Hono and Redis](https://vercel.com/kb/guide/ship-a-github-code-review-bot-with-hono-and-redis?utm_source=chat-sdk_repo&utm_medium=readme&utm_campaign=adapter-github&utm_content=ship-a-github-code-review-bot-with-hono-and-redis) — Walks through building a GitHub bot that reviews pull requests on demand. When a user @mentions the bot on a PR, Chat SDK picks up the mention, spins up a Vercel Sandbox with the repo cloned, and uses AI SDK to analyze the diff.

See all guides and templates at [chat-sdk.dev/resources](https://chat-sdk.dev/resources?utm_source=chat-sdk_repo&utm_medium=readme&utm_campaign=adapter-github&utm_content=resources).

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
