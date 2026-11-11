# tanstack-start-chat

A Slack bot and browser chat built with Chat SDK on [TanStack Start](https://tanstack.com/start), replying with [TanStack AI](https://tanstack.com/ai) through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

This project shows:

- a Slack webhook route as a TanStack Start server route (`src/routes/api/webhooks/$platform.ts`)
- thread history converted with `toTanStackMessages` from `chat/ai/tanstack`
- a TanStack AI `chat()` stream, via `@tanstack/ai-vercel-gateway`, posted straight to the thread with `thread.post()`
- a TanStack AI server tool (`getCurrentTime` in `src/lib/tools.ts`)
- a browser chat page (`src/routes/chat.tsx`) that connects TanStack AI's `useChat` to the Chat SDK web adapter over [AG-UI](https://docs.ag-ui.com)

The bot subscribes to a thread when it is mentioned, then keeps replying to follow-ups in that thread with the last 20 messages as context. It also answers direct messages.

## Prerequisites

- Node.js 20+
- pnpm
- A Slack app, if you want the Slack bot (`slack-manifest.yml` has the scopes and events it needs)
- A [Vercel AI Gateway API key](https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys)

## 1) Install

```bash
pnpm install
```

## 2) Configure environment

```bash
cp .env.example .env.local
```

Required:

- `AI_GATEWAY_API_KEY` (not needed on Vercel, where the adapter falls back to `VERCEL_OIDC_TOKEN`)

For the Slack bot:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET` (the Slack adapter is only created when this is set, so you can run the browser chat without Slack)

Optional:

- `BOT_USERNAME` (default `mybot`)
- `REDIS_URL` (subscriptions and locks fall back to in-memory state, which does not survive restarts)

## 3) Run in dev mode

```bash
pnpm --filter example-tanstack-start-chat dev
```

The app runs on http://localhost:3000. Expose it with a tunnel such as `ngrok http 3000`, then set the Slack app's event subscription and interactivity request URLs to `https://<your-tunnel>/api/webhooks/slack`.

Mention the bot in a channel it has joined, for example `@mybot what time is it in Tokyo?`.

To chat in the browser, open http://localhost:3000/chat. The page uses TanStack AI's `useChat` with `fetchServerSentEvents("/api/webhooks/web")`, and the web adapter in `src/lib/bot.ts` is created with `protocol: "ag-ui"` so it speaks the same event stream. The same handlers answer both Slack and the browser. The demo signs every browser request in as a fixed user, so replace `getUser` with your app's auth before you deploy it.

## 4) Deploy to Vercel

The Vite config includes the [Nitro](https://nitro.build) plugin, which Vercel detects with zero configuration. Deploy the app, enable AI Gateway on the project, add the Slack environment variables, and point the Slack app at `https://<your-deployment>/api/webhooks/slack`.

## Changing the model

The model is set in `src/lib/bot.ts`:

```ts
adapter: vercelGatewayText("anthropic/claude-sonnet-5"),
```

Any chat model id that AI Gateway supports works here. See the [TanStack AI guide](https://chat-sdk.dev/docs/ai/tanstack-ai) for giving the model Chat SDK tools with `createTanStackTools`.
