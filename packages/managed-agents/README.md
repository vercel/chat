# @chat-adapter/managed-agents

> npm package: [`@chat-adapter/managed-agents`](https://www.npmjs.com/package/@chat-adapter/managed-agents)

[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Connect hosted agents to [Chat SDK](https://chat-sdk.dev) threads. Each thread gets one provider session, replies stream back with tool progress, and tool approvals become Approve/Deny cards.

Documentation: [chat-sdk.dev/docs/ai/managed-agents](https://chat-sdk.dev/docs/ai/managed-agents) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Drivers

| Provider | Import | Peer dependency |
| --- | --- | --- |
| [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) | `@chat-adapter/managed-agents/claude` | `@anthropic-ai/sdk` |
| [Cursor agents](https://cursor.com/docs/sdk/typescript) | `@chat-adapter/managed-agents/cursor` | `@cursor/sdk` |
| [OpenAI Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview) | `@chat-adapter/managed-agents/openai` | `openai` |

## Installation

```bash
pnpm add @chat-adapter/managed-agents @anthropic-ai/sdk
```

## Usage

```typescript
import { createManagedAgent } from "@chat-adapter/managed-agents";
import { createClaudeDriver } from "@chat-adapter/managed-agents/claude";
import { Chat } from "chat";

const agent = createManagedAgent({
  // Reads ANTHROPIC_API_KEY, CLAUDE_AGENT_ID, and CLAUDE_ENVIRONMENT_ID.
  driver: createClaudeDriver(),
});

const bot = new Chat({
  adapters,
  concurrency: "queue",
  state,
  userName: "agent",
});

bot.onNewMention(async (thread, message, context) => {
  await thread.subscribe();
  await agent.reply(thread, message, context);
});

bot.onSubscribedMessage((thread, message, context) =>
  agent.reply(thread, message, context)
);

bot.onAction([...agent.actionIds], (event) => agent.handleAction(event));
```

Use a persistent state adapter such as Redis in production. The session ID lives in thread state, so memory state loses it on restart.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
