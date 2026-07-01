---
name: chat-sdk
description: Build multi-platform chat bots with Chat SDK (`chat` npm package). Use when developers want to scaffold a bot with create-chat-sdk, build a Slack, Teams, Google Chat, Discord, Telegram, GitHub, Linear, or WhatsApp bot, handle mentions, direct messages, subscribed threads, reactions, slash commands, cards, modals, files, or AI streaming, set up webhook routes or multi-adapter bots, send rich cards or streamed AI responses to chat platforms, or build a custom adapter or state adapter.
license: MIT
---

# Chat SDK

Unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, Telegram, GitHub, Linear, WhatsApp, and more. Write your bot logic once, deploy everywhere.

## Scaffold a new project

Use `create-chat-sdk` to scaffold a basic Next.js bot project without prompts. Run `npx create-chat-sdk --help` to see the available options and how the CLI works.

## Start with Chat SDK documentation

When Chat SDK is installed in a user's project, inspect the published docs that ship in `node_modules/chat/docs/`, the resources in `node_modules/chat/resources/`, and the available open source templates in `node_modules/chat/resources/templates.json`.

If those paths do not exist, the `chat` package is not installed in the project yet. The user can install it with `npm i chat`.

You can also find the docs on the [Chat SDK website](https://chat-sdk.dev/docs) and in the [Vercel knowledge base](https://vercel.com/kb/chat-sdk).

## Available resources

<!-- RESOURCES:START -->

### Guides

- `node_modules/chat/resources/guides/how-to-build-an-ai-agent-for-slack-with-chat-sdk-and-ai-sdk.md` — Build a Slack AI agent using Chat SDK, AI SDK's ToolLoopAgent, and Vercel AI Gateway. Covers project setup, tool definitions, streaming responses, deployment to Vercel, and scaling tool selection with toolpick.
- `node_modules/chat/resources/guides/human-in-the-loop-with-chat-sdk-and-workflow-sdk.md` — Pause durable workflows on Slack approval cards using Chat SDK and Workflow SDK. Uses createWebhook to suspend workflows until a button click, with patterns for multi-stage approvals, timeouts via durable sleep, and approver validation.
- `node_modules/chat/resources/guides/liveblocks-chat-sdk-ai-sdk.md` — Build an AI agent that replies to @-mentions in Liveblocks comment threads with streamed responses and tool calling. Uses Chat SDK, the Liveblocks adapter, AI SDK's ToolLoopAgent, and Redis for thread subscriptions and distributed locking.
- `node_modules/chat/resources/guides/slack-bot-vercel-blob.md` — Build a Slack bot that lists, reads, uploads, and deletes files in Vercel Blob through tool calls. Uses Chat SDK, AI SDK's ToolLoopAgent, and Files SDK's createFileTools factory with approval-gated write tools and a read-only mode.
- `node_modules/chat/resources/guides/run-and-track-deploys-from-slack.md` — Build a Slack deploy bot with Chat SDK and Vercel Workflow. Dispatch GitHub Actions from a slash command, gate production behind approval, poll for completion, and notify Linear and GitHub when the run finishes.
- `node_modules/chat/resources/guides/triage-form-submissions-with-chat-sdk.md` — Build a Slack bot that triages form submissions with interactive cards. Forward, edit, or mark as spam without leaving Slack. Built with Chat SDK, Hono, and Resend.
- `node_modules/chat/resources/guides/how-to-build-a-slack-bot-with-next-js-and-redis.md` — This guide walks through building a Slack bot with Next.js, covering project setup, Slack app configuration, event handling, interactive features, and deployment.
- `node_modules/chat/resources/guides/create-a-discord-support-bot-with-nuxt-and-redis.md` — This guide walks through building a Discord support bot with Nuxt, covering project setup, Discord app configuration, Gateway forwarding, AI-powered responses, and deployment.
- `node_modules/chat/resources/guides/ship-a-github-code-review-bot-with-hono-and-redis.md` — This guide walks through building a GitHub bot that reviews pull requests on demand. When a user @mentions the bot on a PR, Chat SDK picks up the mention, spins up a Vercel Sandbox with the repo cloned, and uses AI SDK to analyze the diff.
- `node_modules/chat/resources/guides/build-a-slack-bot-with-vercel-connect.md` — Learn how to build your very own Slackbot with Chat SDK and AI SDK. Vercel Connect supplies runtime Slack tokens and forwards triggers, so you never store a long-lived bot token.
- `node_modules/chat/resources/guides/vercel-connect.md` — Use Vercel Connect to call provider APIs like Slack, GitHub, and Snowflake from your agents and services with short-lived, user-authorized tokens instead of long-lived secrets.
- `node_modules/chat/resources/guides/ai-gateway-and-ai-sdk.md` — Build AI agents on Vercel with AI Gateway and AI SDK, then make them reliable, capable, and durable with Sandbox, Chat SDK, Vercel Connect, and Workflow.
- `node_modules/chat/resources/guides/daily-digest-bot-with-chat-sdk-and-workflow-sdk.md` — Create your own daily digest bot that posts a daily digest of GitHub stats to Slack. Learn how to use Vercel Connect to set up Slack and GitHub app securely in your project.

### Templates

Listed in `node_modules/chat/resources/templates.json`:

- **Chat SDK Liveblocks Bot** — Build a bot that you can engage with inside Liveblocks. (https://vercel.com/templates/next.js/chat-sdk-liveblocks-bot)
- **Durable iMessage Agent** — Durable iMessage agent powered by the Sendblue adapter. (https://vercel.com/templates/nitro/durable-imessage-ai-agent)
- **Knowledge Agent** — Open source file-system and knowledge based agent template. Build AI agents that stay up to date with your knowledge base. (https://vercel.com/templates/nuxt/chat-sdk-knowledge-agent)
- **Community Agent** — Open source AI-powered Slack community management bot with a built-in Next.js admin panel. Uses Chat SDK, AI SDK, and Vercel Workflow. (https://vercel.com/templates/next.js/chat-sdk-community-agent)
- **Caltext** — iMessage calorie tracking assistant powered by AI. (https://vercel.com/templates/hono/caltext)

<!-- RESOURCES:END -->

## Chat SDK adapters

### Adapter directory

See the 'Official Adapters', 'Vendor-Official Adapters', and 'Community Adapters' sections in the [Chat SDK llms.txt file](https://chat-sdk.dev/llms.txt) for the current list of official, vendor-official, and community adapters.

### Adapter catalog subpath

Chat SDK exposes a zero-dependency static catalog at `chat/adapters`.

Agents can import `ADAPTERS`, `ADAPTER_NAMES`, `getAdapter`, `isAdapterSlug`, `listEnvVars`, `getSecretEnvVars`, and metadata types like `CatalogAdapter` and `AdapterSlug` from this subpath without importing any adapter implementation package.

Use it for:
- Listing official and vendor-official adapter slugs, names, npm packages, groups, and platform vs state types.
- Building setup or onboarding flows that need package names, peer dependencies, and install guidance before any adapter is installed.
- Discovering required, optional, and credential-mode environment variables for an adapter, including which variables are secrets.
- Keeping vendor-official adapter docs and metadata aligned with the catalog when adding or updating a listed adapter.