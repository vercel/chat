# Chat SDK Bot

A chat bot built with [Chat SDK](https://chat-sdk.dev), a unified TypeScript SDK by Vercel for building bots across Slack, Teams, Google Chat, Discord, WhatsApp, and more.

## Getting Started

1. Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env.local
```

2. Start the dev server:

```bash
npm run dev
```

3. Expose your local server to the internet (e.g. with [ngrok](https://ngrok.com)) and configure your platform's webhook URL to point to:

```
https://<your-url>/api/webhooks/<platform>
```

Replace `<platform>` with `slack`, `teams`, `gchat`, `discord`, etc.

## Project Structure

```
src/
  lib/bot.ts                              Bot configuration and handlers
  app/api/webhooks/[platform]/route.ts    Webhook endpoint (all platforms)
.env.example                              Required environment variables
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server |

## Learn More

- [Chat SDK Documentation](https://chat-sdk.dev/docs)
- [Adapter Setup Guides](https://chat-sdk.dev/docs/adapters)
- [GitHub Repository](https://github.com/vercel/chat)
