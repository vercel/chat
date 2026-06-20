# express-discord-chat

A minimal Express + Chat SDK example using the Discord adapter.

This project shows:

- one Discord webhook endpoint wired through Express
- one simple REST endpoint to send DMs (`POST /api/messages/dm`)
- two simple slash commands (`/hello`, `/status`)
- one basic mention handler

## Prerequisites

- Node.js 20+
- pnpm
- A Discord application + bot

## 1) Install

```bash
pnpm install
```

## 2) Configure environment

Copy the example env file and fill in your Discord credentials:

```bash
cp .env.example .env
```

Required:

- `DISCORD_BOT_TOKEN`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`

Optional:

- `PORT` (default `3001`)
- `BOT_USERNAME` (default `express-chat-sdk-bot`)

## 3) Run in dev mode

```bash
pnpm --filter example-express-discord-chat dev
```

Expected startup output:

```text
Express Chat SDK example running on http://localhost:3001
```

## 4) Build and start production output

Build:

```bash
pnpm --filter example-express-discord-chat build
```

Start compiled app:

```bash
pnpm --filter example-express-discord-chat start
```

## 5) Connect Discord webhook

Expose your local server with a tunnel (example with ngrok):

```bash
ngrok http 3001
```

In Discord Developer Portal:

1. Open your application
2. Go to **General Information**
3. Set **Interactions Endpoint URL** to:
   - `https://<your-domain>/api/webhooks/discord`

Discord will send a verification ping to this endpoint.

## 6) Register slash commands

Create these commands in your Discord app (Developer Portal):

- `/hello`
- `/status`

Then invite your bot to a server with `bot` and `applications.commands` scopes.

## Endpoint

### `POST /api/webhooks/discord`

Discord sends interactions here. The handler calls `chat.webhooks.discord(request)`.

### `POST /api/messages/dm`

Sends a DM through Chat SDK.

Request body:

```json
{
  "userId": "1033044521375764530",
  "text": "Hello from Express REST API"
}
```

Success response:

```json
{
  "sent": true,
  "userId": "1033044521375764530"
}
```

## What to test in Discord

1. Run `/hello` in a channel where the bot is present
   - Expected: greeting from the bot
2. Run `/status`
   - Expected: adapter name and thread id in the response
3. Mention the bot in a message
   - Expected: bot replies with a short acknowledgment

## Additional notes

- This example intentionally uses in-memory state (`@chat-adapter/state-memory`) to keep setup simple.
- `POST /api/webhooks/discord` uses `express.raw()` so Discord signature verification works correctly.
- If you want regular message events (not only interactions), add a Gateway listener route/worker in addition to the webhook route.
- Chat SDK webhook handlers use the Web `Request`/`Response` API, so this example adapts Express request/response objects in a few lines inside the route.
- This example is intentionally small and focused on showing how Chat SDK plugs into plain Express.

## Further reading

- [Build with an Express starter template](https://vercel.com/kb/guide/build-with-a-express-starter-template)
- [How to ship an Express app on Vercel](https://vercel.com/kb/guide/ship-a-express-app-on-vercel)
