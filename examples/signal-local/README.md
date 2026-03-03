# Signal Adapter — Local Testing Examples

Standalone scripts for testing the Signal adapter against a local `signal-cli-rest-api` instance running in **json-rpc mode** (WebSocket).

## Prerequisites

1. **signal-cli-rest-api** running locally in json-rpc mode (default: `http://localhost:8080`)

   ```bash
   docker run -d --name signal-api \
     -p 8080:8080 \
     -v $HOME/.local/share/signal-cli:/home/.local/share/signal-cli \
     -e MODE=json-rpc \
     bbernhard/signal-cli-rest-api:latest
   ```

2. A registered/linked phone number in signal-cli-rest-api.

3. Build the monorepo:

   ```bash
   pnpm install && pnpm build
   ```

## Environment

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `SIGNAL_PHONE_NUMBER` | Yes | Your bot's registered phone number (e.g. `+14155551234`) |
| `SIGNAL_SERVICE_URL` | No | signal-cli-rest-api URL (default: `http://localhost:8080`) |
| `SIGNAL_RECIPIENT` | Yes* | Phone number to send test messages to (*scripts 02-05) |

## Scripts

Run from this directory with `npx tsx` or use the `pnpm` shortcuts:

### 1. Health check & account verification

```bash
npx tsx 01-health-check.ts     # or: pnpm health
```

Verifies connectivity to signal-cli-rest-api and that your phone number is registered.

### 2. Send, edit, delete messages

```bash
npx tsx 02-send-edit-delete.ts  # or: pnpm send
```

Posts a message, edits it twice, fetches it from cache, then deletes it.

### 3. Reactions

```bash
npx tsx 03-reactions.ts         # or: pnpm react
```

Posts a message and adds/removes reactions.

### 4. Typing indicator

```bash
npx tsx 04-typing.ts            # or: pnpm typing
```

Sends a typing indicator, waits 3s, then posts a message.

### 5. Group messaging

```bash
SIGNAL_GROUP_ID="group.abc123==" npx tsx 05-group.ts  # or: pnpm group
```

Posts a message to a Signal group, fetches group metadata. List your groups with:

```bash
curl http://localhost:8080/v1/groups/YOUR_PHONE_NUMBER
```

### 6. WebSocket receive (json-rpc mode)

```bash
npx tsx 06-poll-receive.ts      # or: pnpm poll
```

Connects via WebSocket to `ws://localhost:8080/v1/receive/{number}` and prints incoming messages, reactions, and edits. Send messages from your Signal app to see them arrive. Ctrl+C to stop.

### 7. Webhook server (alternative)

```bash
npx tsx 07-webhook-server.ts    # or: pnpm webhook
```

Starts an HTTP server on port 3000 that receives Signal webhooks. Use this if you prefer webhook mode. Configure `RECEIVE_WEBHOOK_URL=http://host.docker.internal:3000/webhook` in signal-cli-rest-api.

### 8. Echo bot (WebSocket)

```bash
npx tsx 08-echo-bot.ts          # or: pnpm bot
```

A simple echo bot using WebSocket receive. Replies to DMs, echoes messages in groups when mentioned, reacts to incoming reactions with 🤝.
