# AGENTS.md

This is a chat bot built with [Chat SDK](https://chat-sdk.dev), a unified TypeScript SDK by Vercel for building bots across Slack, Teams, Google Chat, Discord, WhatsApp, and more.

## Commands

```bash
npm run dev      # Start the dev server
npm run build    # Production build
npm run start    # Start production server
```

## Project structure

```
src/
  lib/bot.ts                            # Bot config — adapters, state, handlers
  app/api/webhooks/[platform]/route.ts  # Webhook route (all platforms)
.env.example                            # Required environment variables
next.config.ts                          # Next.js config (serverExternalPackages if needed)
```

## How it works

1. Each chat platform sends webhooks to `/api/webhooks/{platform}` (e.g. `/api/webhooks/slack`).
2. The route handler in `route.ts` delegates to the bot's webhook handler for that platform.
3. The bot is configured in `src/lib/bot.ts` with platform adapters, a state adapter, and message handlers.

## Key concepts

- **Adapters** connect the bot to chat platforms. Each adapter handles webhook verification, message parsing, and platform-specific formatting.
- **State adapter** provides persistence for subscriptions and distributed locking (e.g. Redis, PostgreSQL). In-memory state is for development only.
- **Handlers** respond to events:
  - `onNewMention` — bot is @mentioned in a new thread
  - `onSubscribedMessage` — new message in a thread the bot is subscribed to
  - `onNewMessage` — messages matching a pattern (e.g. regex, keyword)
  - `onReaction` — reaction added to a message
  - `onSlashCommand` — slash command invoked (Slack, Discord)
- **Thread** represents a conversation. Use `thread.post()` to send messages, `thread.subscribe()` to listen for follow-ups.
- **Cards** are rich messages built with JSX (using `jsxImportSource: "chat"` in tsconfig). Import components from `chat/cards`.

## Environment variables

Use your 'chat-sdk' skill and other applicable skills while working on this project.

## Docs

Full documentation: https://chat-sdk.dev/docs
