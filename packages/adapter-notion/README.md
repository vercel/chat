[![Notion adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/notion/og)](https://chat-sdk.dev/adapters/official/notion)

# @chat-adapter/notion

> npm package: [`@chat-adapter/notion`](https://www.npmjs.com/package/@chat-adapter/notion)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Notion adapter for [Chat SDK](https://chat-sdk.dev). Participate in page and block comment discussions via Notion webhooks and the Comments API.

Documentation: [chat-sdk.dev/adapters/official/notion](https://chat-sdk.dev/adapters/official/notion) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/notion
```

## Scaffold with the CLI

To scaffold a new Notion bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter notion memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

The adapter auto-detects credentials from `NOTION_TOKEN`, `NOTION_VERIFICATION_TOKEN`, and optional `NOTION_BOT_USERNAME` / `NOTION_VERSION` / `NOTION_MENTION_MODE` / `NOTION_KEYWORDS`:

```typescript
import { Chat } from "chat";
import { createNotionAdapter } from "@chat-adapter/notion";

const bot = new Chat({
  userName: "my-bot",
  adapters: {
    notion: createNotionAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Notion!");
});
```

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
