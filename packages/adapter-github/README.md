# @chat-adapter/github

GitHub adapter for the [chat](https://github.com/vercel-labs/chat) SDK. Enables bots to respond to @mentions in GitHub PR comment threads.

## Installation

```bash
npm install chat @chat-adapter/github
```

## Usage

```typescript
import { Chat } from "chat";
import { createGitHubAdapter } from "@chat-adapter/github";
import { MemoryState } from "@chat-adapter/state-memory";

const chat = new Chat({
  userName: "my-bot",
  adapters: {
    github: createGitHubAdapter({
      token: process.env.GITHUB_TOKEN!,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
      userName: "my-bot",
      logger: console,
    }),
  },
  state: new MemoryState(),
  logger: "info",
});

// Handle @mentions in PR comments
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from GitHub!");
});
```

## Configuration

| Option           | Required | Description                                                                                                                                                    |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`          | Yes\*    | [Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) with `repo` scope |
| `appId`          | Yes\*    | [GitHub App](https://docs.github.com/en/apps/creating-github-apps) ID                                                                                          |
| `privateKey`     | For Apps | GitHub App private key (PEM format)                                                                                                                            |
| `installationId` | No       | Installation ID (omit for multi-tenant)                                                                                                                        |
| `webhookSecret`  | Yes      | [Webhook secret](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) for signature verification                                  |
| `userName`       | Yes      | Bot username for @mention detection                                                                                                                            |
| `botUserId`      | No       | Bot's numeric user ID (auto-detected if not provided)                                                                                                          |

\*Either `token` or `appId`/`privateKey` is required.

## Environment Variables

```bash
# Personal Access Token auth
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# OR GitHub App auth
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_INSTALLATION_ID=12345678  # Optional for multi-tenant apps

# Webhook secret (required)
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

## GitHub Setup

### Option A: Personal Access Token (PAT)

Best for personal projects, testing, or simple single-repo bots.

1. Go to [Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Create a new token with `repo` scope
3. Set `GITHUB_TOKEN` environment variable

### Option B: GitHub App (Recommended)

Better rate limits, security, and supports multiple installations.

#### 1. Create the App

1. Go to [Settings → Developer settings → GitHub Apps → New GitHub App](https://github.com/settings/apps/new)
2. Fill in:
   - **Name**: Your bot's name
   - **Homepage URL**: Your app's website
   - **Webhook URL**: `https://your-domain.com/api/webhooks/github`
   - **Webhook secret**: Generate a secure secret
3. Set **Permissions**:
   - Repository -> Issues: Read & write
   - Repository -> Pull requests: Read & write
   - Repository -> Metadata: Read-only
4. Subscribe to **events**:
   - Issue comment
   - Pull request review comment
5. Under "Where can this GitHub App be installed?":
   - **Only on this account** - For private/testing apps
   - **Any account** - For public apps others can install
6. Click **"Create GitHub App"**
7. Note your **App ID** from the app settings page (shown at the top)
8. Scroll down and click **"Generate a private key"** - save the downloaded `.pem` file

#### 2. Install the App

1. After creating the app, go to your app's settings page
2. Click **"Install App"** in the left sidebar
3. Click **"Install"** next to your organization or account
4. Choose which repositories to grant access:
   - **All repositories** - App can access all current and future repos
   - **Only select repositories** - Pick specific repos (recommended for testing)
5. Click **"Install"**
6. Note the **Installation ID** from the URL after installation:
   ```
   https://github.com/settings/installations/12345678
                                              ^^^^^^^^
                                              This is your Installation ID
   ```

#### 3. Configure the Adapter

**Single-tenant (fixed installation):**

```typescript
createGitHubAdapter({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_PRIVATE_KEY!,
  installationId: parseInt(process.env.GITHUB_INSTALLATION_ID!),
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
  userName: "my-bot[bot]",
  logger: console,
});
```

**Multi-tenant (public app anyone can install):**

Simply omit `installationId`. The adapter automatically extracts it from webhooks and caches API clients per-installation:

```typescript
import { Chat } from "chat";
import { createGitHubAdapter } from "@chat-adapter/github";
import { RedisState } from "@chat-adapter/state-redis";

const chat = new Chat({
  userName: "my-bot[bot]",
  adapters: {
    github: createGitHubAdapter({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_PRIVATE_KEY!,
      // No installationId - handled automatically!
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
      userName: "my-bot[bot]",
      logger: console,
    }),
  },
  // Use Redis to persist installation mappings
  state: new RedisState({ url: process.env.REDIS_URL! }),
  logger: "info",
});
```

### Webhook Setup

See the [GitHub Webhooks documentation](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks) for detailed instructions.

**For repository/org webhooks:**

1. Go to repository/org **Settings → Webhooks → Add webhook**
2. Set **Payload URL** to `https://your-domain.com/api/webhooks/github`
3. Set **Content type** to `application/json` (**required** - the default `application/x-www-form-urlencoded` will not work)
4. Set **Secret** to match your `webhookSecret`
5. Select events:
   - [Issue comments](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issue_comment) (PR-level)
   - [Pull request review comments](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request_review_comment) (line-specific)

**For GitHub Apps:** Webhooks are configured during app creation. Make sure to select `application/json` as the content type.

## Features

- Message posting and editing
- Message deletion
- [Reaction handling](https://docs.github.com/en/rest/reactions) (add/remove)
- PR-level comments (Conversation tab)
- Review comment threads (Files Changed tab - line-specific)
- Cards (rendered as [GitHub Flavored Markdown](https://github.github.com/gfm/))
- Multi-tenant support (automatic installation ID handling)

## Thread Model

GitHub has two types of comment threads:

| Type            | Tab           | API                                                                  | Thread ID Format                                  |
| --------------- | ------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| PR-level        | Conversation  | [Issue Comments](https://docs.github.com/en/rest/issues/comments)    | `github:{owner}/{repo}:{prNumber}`                |
| Review comments | Files Changed | [PR Review Comments](https://docs.github.com/en/rest/pulls/comments) | `github:{owner}/{repo}:{prNumber}:rc:{commentId}` |

Example thread IDs:

- `github:acme/app:123` (PR-level)
- `github:acme/app:123:rc:456789` (line-specific review comment)

## Reactions

Supports [GitHub's reaction emoji](https://docs.github.com/en/rest/reactions/reactions#about-reactions):

| SDK Emoji     | GitHub Reaction |
| ------------- | --------------- |
| `thumbs_up`   | 👍 (+1)         |
| `thumbs_down` | 👎 (-1)         |
| `laugh`       | 😄              |
| `confused`    | 😕              |
| `heart`       | ❤️              |
| `hooray`      | 🎉              |
| `rocket`      | 🚀              |
| `eyes`        | 👀              |

## Limitations

- **No typing indicators** - GitHub doesn't support typing indicators
- **No streaming** - Messages posted in full (editing supported for updates)
- **No DMs** - GitHub doesn't have direct messages
- **No modals** - GitHub doesn't support interactive modals
- **Action buttons** - Rendered as text; use link buttons for clickable actions

## Troubleshooting

### "Invalid signature" error

- Verify `GITHUB_WEBHOOK_SECRET` matches your webhook configuration
- Ensure the request body isn't being modified before verification

### "Invalid JSON" error

- Change webhook **Content type** to `application/json` (GitHub defaults to `application/x-www-form-urlencoded` which doesn't work)

### Bot not responding to mentions

- Verify webhook events are configured (issue_comment, pull_request_review_comment)
- Check that the webhook URL is correct and accessible
- Ensure the bot has been installed on the repository
- Verify the `userName` config matches your bot's GitHub username

### "Installation ID required" error

- This occurs when making API calls outside webhook context in multi-tenant mode
- Ensure you're using a persistent state adapter (Redis) to store installation mappings
- The first interaction must come from a webhook to establish the mapping

### Rate limiting

- [PATs have lower rate limits](https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api) than GitHub Apps
- Consider switching to a GitHub App for production use

## License

MIT
