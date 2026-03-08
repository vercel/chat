# @chat-adapter/signal

[![npm version](https://img.shields.io/npm/v/@chat-adapter/signal)](https://www.npmjs.com/package/@chat-adapter/signal)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/signal)](https://www.npmjs.com/package/@chat-adapter/signal)

Signal adapter for [Chat SDK](https://chat-sdk.dev/docs).

## Installation

```bash
npm install chat @chat-adapter/signal
```

## Setup

This adapter requires [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) as the bridge between your bot and the Signal network.

### 1. Start signal-cli-rest-api

**With webhook delivery** (recommended for production):

```bash
docker run -d --name signal-api \
  -p 8080:8080 \
  -v ~/.local/share/signal-cli:/home/.local/share/signal-cli \
  -e MODE=json-rpc \
  -e RECEIVE_WEBHOOK_URL=http://host.docker.internal:3000/api/webhooks/signal \
  bbernhard/signal-cli-rest-api
```

**Without webhook** (use WebSocket or polling to receive):

```bash
docker run -d --name signal-api \
  -p 8080:8080 \
  -v ~/.local/share/signal-cli:/home/.local/share/signal-cli \
  -e MODE=json-rpc \
  bbernhard/signal-cli-rest-api
```

> **Note:** `host.docker.internal` resolves to your host machine from inside Docker. On Linux, use your machine's LAN IP instead (e.g. `http://192.168.1.x:3000/api/webhooks/signal`).

### 2. Register or link a phone number

You need a phone number registered with signal-cli-rest-api. There are two approaches:

#### Option A: Link as a secondary device (recommended)

This lets you keep using Signal on your phone alongside the bot.

1. Open the QR code link page:

   ```bash
   # Open in your browser:
   http://localhost:8080/v1/qrcodelink?device_name=signal-bot
   ```

2. On your phone, go to **Signal → Settings → Linked Devices → Link New Device** and scan the QR code.

3. Verify the link worked:

   ```bash
   curl http://localhost:8080/v1/accounts
   # Should return: ["+1234567890"]
   ```

#### Option B: Register a new number

This registers the number exclusively with signal-cli (your phone will be disconnected from Signal).

1. Get a captcha token from [signalcaptchas.org/registration/generate.html](https://signalcaptchas.org/registration/generate.html). After completing the captcha, right-click the "Open Signal" link and copy the URL.

2. Register:

   ```bash
   curl -X POST 'http://localhost:8080/v1/register/+1234567890' \
     -H 'Content-Type: application/json' \
     -d '{"captcha": "signalcaptcha://signal-recaptcha-v2.yourtoken..."}'
   ```

3. Verify with the SMS code you receive:

   ```bash
   curl -X POST 'http://localhost:8080/v1/register/+1234567890/verify/123456'
   ```

#### Handling captchas during operation

Signal may occasionally require a captcha challenge when sending messages (error 429 with `challenge_tokens`). To resolve:

1. Get a captcha token from [signalcaptchas.org/challenge/generate.html](https://signalcaptchas.org/challenge/generate.html).

2. Submit it along with the challenge token from the error:

   ```bash
   curl -X POST 'http://localhost:8080/v1/accounts/+1234567890/rate-limit-challenge' \
     -H 'Content-Type: application/json' \
     -d '{
       "challenge_token": "<token from error response>",
       "captcha": "signalcaptcha://signal-recaptcha-v2.yourtoken..."
     }'
   ```

### 3. Configure the adapter

Set environment variables:

```bash
SIGNAL_PHONE_NUMBER=+1234567890
SIGNAL_SERVICE_URL=http://localhost:8080  # optional, this is the default
```

## Usage

```typescript
import { Chat } from "chat";
import { createSignalAdapter } from "@chat-adapter/signal";

const signal = createSignalAdapter({
  phoneNumber: process.env.SIGNAL_PHONE_NUMBER!,
  baseUrl: process.env.SIGNAL_SERVICE_URL,
});

const bot = new Chat({
  userName: "mybot",
  adapters: {
    signal,
  },
});
```

During initialization, the adapter performs a fail-fast health check against `signal-cli-rest-api` (`/v1/health`) and verifies that the configured `phoneNumber` is present in `/v1/accounts`. Initialization fails early if either check does not pass.

### Receiving updates

#### Webhook mode (recommended for hosted deployments)

Set `RECEIVE_WEBHOOK_URL` in signal-cli-rest-api (see Docker setup above) to POST incoming updates to your app's Signal webhook endpoint.

#### WebSocket mode (recommended for local/self-hosted)

In json-rpc mode, connect to the WebSocket endpoint at `ws://localhost:8080/v1/receive/{number}` and feed messages through `handleWebhook()`. See the [local testing examples](../../examples/signal-local/) for a ready-made helper.

#### Polling mode

The adapter also exposes polling helpers for `GET /v1/receive/{number}` (only works in normal mode, not json-rpc):

```typescript
signal.startPolling({ intervalMs: 1000 });

// later (shutdown)
await signal.stopPolling();
```

Or run a single polling cycle:

```typescript
const count = await signal.pollOnce();
console.log(`Processed ${count} updates`);
```

## Examples

See [`examples/signal-local/`](../../examples/signal-local/) for standalone scripts you can run against a local signal-cli-rest-api instance:

- **Health check** — verify connectivity and account registration
- **Send / edit / delete** — message lifecycle
- **Reactions** — add, replace, remove (Signal allows one reaction per user per message)
- **Typing indicators** — show typing, then send
- **Group messaging** — post to groups, fetch group metadata
- **WebSocket receive** — listen for incoming messages via WebSocket
- **Webhook server** — HTTP server for webhook-based receive
- **Echo bot** — full echo bot with DM/group support and reaction mirroring

## Known Limitations

### No delivery guarantees on receive

The receive paths exposed by `signal-cli-rest-api` lack formal delivery guarantees — there is no acknowledgment protocol, offset tracking, or retry mechanism at the transport layer. If your process crashes after receiving messages but before fully processing them, those messages may be lost. This is a limitation of `signal-cli-rest-api` itself, not this adapter.

- **REST polling** (`GET /v1/receive`): messages are consumed the moment the HTTP response is sent — the riskiest path.
- **WebSocket** (`ws://.../v1/receive/{number}`): messages are pushed and immediately considered delivered.
- **Webhook** (`RECEIVE_WEBHOOK_URL`): signal-cli-rest-api POSTs synchronously and waits for your response, so messages aren't discarded while your server is processing. However, there is no retry on non-2xx responses. This makes webhooks the most reliable of the three options.

### `fetchMessages` and `fetchMessage` are cache-backed

Like the Telegram adapter, Signal message fetch APIs are backed by an in-memory cache of messages seen by the current process (incoming webhooks/polls and adapter sends/edits). They are best-effort convenience APIs, not an authoritative server-side history.

### One reaction per user per message

Signal only allows a single reaction per user per message. Adding a new reaction replaces the previous one.

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/signal](https://chat-sdk.dev/docs/adapters/signal).

## License

MIT
