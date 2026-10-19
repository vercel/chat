# nextjs-managed-agents

A Slack bot that runs a hosted agent in each thread, built with Chat SDK, Next.js, and [`@chat-adapter/managed-agents`](../../packages/managed-agents). It works with [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), [Cursor agents](https://cursor.com/docs/sdk/typescript), or the [OpenAI Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview); set `AGENT_PROVIDER` to choose.

This project shows:

- one agent session per Slack thread, stored in Redis
- streamed replies, with tool calls shown as Slack task cards
- Approve/Deny cards when the agent asks to run a tool (Claude)
- switching providers with one environment variable (`src/lib/agent.ts`)

Mention the bot in a channel and it subscribes to the thread, so follow-ups don't need another mention. It also answers direct messages.

## Prerequisites

- Node.js 22.13+ (required by `@cursor/sdk`)
- pnpm
- Redis
- A Slack app (`slack-manifest.yml` has the scopes, events, and interactivity it needs)
- For Claude: an Anthropic API key with Managed Agents access, and an existing agent ID and environment ID
- For Cursor: a Cursor API key
- For OpenAI: an OpenAI API key with Agents API access, and an existing agent ID

## 1) Install

```bash
pnpm install
```

## 2) Configure environment

```bash
cp .env.example .env.local
```

Always required:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `REDIS_URL`

For `AGENT_PROVIDER=claude` (the default):

- `ANTHROPIC_API_KEY`
- `CLAUDE_AGENT_ID`
- `CLAUDE_ENVIRONMENT_ID`

For `AGENT_PROVIDER=cursor`:

- `CURSOR_API_KEY`
- `CURSOR_REPO_URL` (optional; without it the agent runs on an empty cloud VM, which must be enabled for your account)
- `CURSOR_MODEL` (optional, default `composer-2.5`)

For `AGENT_PROVIDER=openai`:

- `OPENAI_API_KEY`
- `OPENAI_AGENT_ID`
- `OPENAI_ENVIRONMENT_ID` (optional; without it sessions run with no execution environment)

Optional:

- `BOT_USERNAME` (default `agent`)

## 3) Run in dev mode

```bash
pnpm --filter example-nextjs-managed-agents dev
```

The app runs on http://localhost:3000. Expose it with a tunnel such as `ngrok http 3000`, then set the Slack app's event subscription and interactivity request URLs to `https://<your-tunnel>/api/webhooks/slack`.

## 4) Deploy to Vercel

Deploy the app, add the environment variables, and point the Slack app at `https://<your-deployment>/api/webhooks/slack`. The webhook route sets `maxDuration = 300` because agent turns can run for minutes.

## How it works

`src/lib/bot.ts` is the whole integration:

```ts
bot.onNewMention(async (thread, message, context) => {
  await thread.subscribe();
  await agent.reply(thread, message, context);
});
bot.onSubscribedMessage((thread, message, context) => agent.reply(thread, message, context));
bot.onAction([...agent.actionIds], (event) => agent.handleAction(event));
```

See the [managed agents guide](https://chat-sdk.dev/docs/ai/managed-agents) for options such as `taskDisplay` and custom messages.
