# telegram-chat

A Telegram bot that exercises the Chat SDK end-to-end: MarkdownV2 rendering, cards with inline-keyboard actions, reactions, file uploads, and streaming edits. Runs in polling mode — no webhook, no public URL, no deploy.

Doubles as a reference example for developers learning the SDK and an interactive smoke-test harness for the `@chat-adapter/telegram` package.

## Prerequisites

- Node.js ≥ 20
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Run

From the repo root:

```bash
pnpm install
TELEGRAM_BOT_TOKEN=<your_token> pnpm --filter example-telegram-chat start
```

Optional: `TELEGRAM_BOT_USERNAME=<handle>` (defaults to `telegramchatdemobot`).

Then DM the bot — any message opens the main menu.

## What you see

The bot replies with an inline keyboard with three categories:

- **Text & Markdown** — 6 curated markdown demos plus a streaming edit loop
- **Cards & Actions** — interactive approval card, callback-data size probe, link buttons
- **Media & Reactions** — on-demand reactions, generated PNG and PDF uploads

Every sub-menu has a `← Back` button. Sending any text at any time reopens the main menu.

## Why it's stateless

No thread subscription, no persistence. Every button press is self-contained; memory state is used only because the SDK requires a state adapter. If you need a stateful reference, see `examples/nextjs-chat`.

## Related

- [`packages/adapter-telegram`](../../packages/adapter-telegram) — adapter source and README
- [`examples/nextjs-chat`](../nextjs-chat) — full multi-platform example with AI integration, Redis state, and webhooks
