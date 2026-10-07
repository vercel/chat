[![GitLab adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/gitlab/og)](https://chat-sdk.dev/adapters/official/gitlab)

# @chat-adapter/gitlab

> npm package: [`@chat-adapter/gitlab`](https://www.npmjs.com/package/@chat-adapter/gitlab)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

GitLab adapter for [Chat SDK](https://chat-sdk.dev). Respond to @mentions in merge request and issue comment threads on GitLab.com, GitLab Self-Managed, or GitLab Dedicated.

Documentation: [chat-sdk.dev/adapters/official/gitlab](https://chat-sdk.dev/adapters/official/gitlab) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/gitlab
```

## Scaffold with the CLI

To scaffold a new GitLab bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter gitlab memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Quick start

The adapter auto-detects credentials from `GITLAB_TOKEN` and either `GITLAB_WEBHOOK_SIGNING_TOKEN` or `GITLAB_WEBHOOK_SECRET`. It looks up the bot's username and user ID from the token during initialization:

```typescript
import { Chat } from "chat";
import { createGitLabAdapter } from "@chat-adapter/gitlab";

const bot = new Chat({
  userName: "my-bot",
  adapters: {
    gitlab: createGitLabAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from GitLab!");
});
```

Point a project or group webhook at `/api/webhooks/gitlab` and select the **Comments** trigger, plus **Emoji events** if you handle reactions.

## Configuration

| Option | Description |
|--------|-------------|
| `token` | Access token with the `api` scope. Auto-detected from `GITLAB_TOKEN`. |
| `webhookSigningToken` | Webhook signing token (`whsec_…`). Auto-detected from `GITLAB_WEBHOOK_SIGNING_TOKEN`. |
| `webhookSecret` | Webhook secret token sent in `X-Gitlab-Token`. Auto-detected from `GITLAB_WEBHOOK_SECRET`. |
| `apiUrl` | REST API base URL for GitLab Self-Managed or Dedicated. Auto-detected from `GITLAB_API_URL`. |

`token` is required, plus a webhook signing token, a secret token, or a custom `webhookVerifier`. See the [full configuration reference](https://chat-sdk.dev/adapters/official/gitlab#configuration) for the remaining options.

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
