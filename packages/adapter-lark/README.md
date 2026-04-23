# @chat-adapter/lark

[![npm version](https://img.shields.io/npm/v/@chat-adapter/lark)](https://www.npmjs.com/package/@chat-adapter/lark)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/lark)](https://www.npmjs.com/package/@chat-adapter/lark)

Lark (Feishu) adapter for [Chat SDK](https://chat-sdk.dev). Configure with a self-build app and WebSocket long-connection event subscription.

## Installation

```bash
pnpm add @chat-adapter/lark
```

## Usage

The adapter auto-detects `LARK_APP_ID`, `LARK_APP_SECRET`, and `LARK_BOT_USERNAME` from environment variables:

```typescript
import { Chat } from "chat";
import { createLarkAdapter } from "@chat-adapter/lark";
import { createMemoryState } from "@chat-adapter/state-memory";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    lark: createLarkAdapter(),
  },
  state: createMemoryState(),
});

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`You said: ${message.text}`);
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post(`Got your DM: ${message.text}`);
});

await bot.initialize();
```

`bot.initialize()` opens the Lark WebSocket connection and keeps it alive until `bot.disconnect()` is called. The process stays alive as long as the WS is open, so no separate server is needed in a long-running environment.

## Creating a Lark app

### Option A — scan-to-create (recommended)

`registerLarkApp` drives Lark's official scan-to-create flow: the SDK
generates a one-time URL, you render it as a QR code, the user scans with
the Lark mobile app and approves, and you get back `client_id` /
`client_secret` — with the permissions and event subscriptions this adapter
needs already configured.

```typescript
import { registerLarkApp, createLarkAdapter } from "@chat-adapter/lark";
import qrcode from "qrcode-terminal"; // `pnpm add -D qrcode-terminal`

const { client_id, client_secret } = await registerLarkApp({
  onQRCodeReady: ({ url }) => {
    console.log("Scan this QR with your Lark mobile app:");
    qrcode.generate(url, { small: true });
  },
  onStatusChange: ({ status }) => console.log("status:", status),
});

// Stash these somewhere durable (env vars, secrets manager, …)
console.log("LARK_APP_ID=", client_id);
console.log("LARK_APP_SECRET=", client_secret);

const adapter = createLarkAdapter({
  appId: client_id,
  appSecret: client_secret,
});
```

You only need to run this once. Persist the returned credentials and feed
them back via `LARK_APP_ID` / `LARK_APP_SECRET` in subsequent runs.

### Option B — create via developer console

Go to the developer console and create an **Intelligent Agent** app:

- Lark: https://open.larksuite.com/app
- Feishu: https://open.feishu.cn/app

Grab the app's `client_id` and `client_secret` and pass them as `appId` / `appSecret` (or set `LARK_APP_ID` / `LARK_APP_SECRET`).

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `appId` | Yes | Lark app ID. Auto-detected from `LARK_APP_ID` |
| `appSecret` | Yes | Lark app secret. Auto-detected from `LARK_APP_SECRET` |
| `userName` | No | Bot display name (defaults to `LARK_BOT_USERNAME` or `"bot"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info", "lark")`) |

`appId` / `appSecret` can be provided via config or the matching env var — whichever is present wins.

## Environment variables

```bash
LARK_APP_ID=cli_xxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxx
LARK_BOT_USERNAME=mybot
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | Via SDK `channel.send({file})` — wrapped through `postMessage` |
| Streaming | Yes — native cardkit typewriter |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Lark interactive cards |
| Buttons | Card action buttons |
| Link buttons | Yes |
| Select menus | Card select / overflow elements |
| Tables | Markdown tables |
| Fields | Card section fields |
| Images in cards | Via `ImageElement` |
| Modals | No (Lark form cards — roadmap) |

### Conversations

| Feature | Supported |
|---------|-----------|
| Slash commands | No |
| Mentions | Yes |
| Add reactions | Yes |
| Remove reactions | Yes |
| Typing indicator | No (Lark has no API) |
| DMs | Yes |
| Ephemeral messages | No (roadmap) |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Yes (via `im.v1.messages.list` + SDK `normalize()`) |
| Fetch single message | Yes |
| Fetch thread info | Yes |
| Fetch channel messages | Yes |
| List threads | Yes (grouped by `root_id` client-side) |
| Fetch channel info | Yes |
| Post channel message | No |

## Thread ID format

Lark thread IDs encode as `lark:{chatId}:{rootId}`:

- `chatId` — `oc_*` for group/p2p chats, `ou_*` for `openDM()` placeholders
- `rootId` — `root_id` if the message has one (it's a reply); else `message_id` (the message is its own root)

Lark's native `thread_id` (topic containers, `omt_*`) is **not** used as the rootId segment — it's a topic container ID, not a message ID, and can't be used as `replyTo` on the send API.

## Notes

- **Transport**: WebSocket only. `handleWebhook()` returns HTTP 501. Webhook transport is on the roadmap; for now, Lark's "long-connection" mode is the intended delivery channel and it works fine in production.
- **Safety layer**: `LarkChannel`'s built-in safety features (stale detection, dedup, per-chat queue, text batch) are disabled. Chat SDK's lock + state adapter handles message deduplication and subscription.
- **DM detection**: Lark p2p chat IDs share the `oc_*` prefix with group chats, so `isDM()` relies on a cache populated by inbound events. The first DM after a process restart may route through `onNewMention` until the cache catches up.
- **Historical bot messages**: `author.isMe` is resolved consistently for bot-authored history entries, not just live events.
- **listThreads**: derived client-side from `im.v1.messages.list`. Paginate carefully for very active chats.
- **Multi-app / multi-tenant**: single-app only. A future version may support `setInstallation()` for multi-tenant fan-out.

## Runnable smoke scenarios

The adapter ships six runnable scenarios under `smokes/` — one per Adapter capability. Each script connects to a real Lark app and exercises a specific flow end-to-end:

```bash
pnpm smoke:echo        # mention / DM / subscribed message routing
pnpm smoke:stream      # cardkit typewriter streaming reply
pnpm smoke:edit        # post → edit → delete a message
pnpm smoke:reactions   # add / remove emoji reactions (+ inbound reaction events)
pnpm smoke:long        # multi-part markdown with code blocks (chunking)
LARK_TEST_CHAT_ID=oc_xxx pnpm smoke:history  # fetchMessages / listThreads / fetchMessage
```

See [`smokes/README.md`](https://github.com/vercel/chat/tree/main/packages/adapter-lark/smokes) for the setup guide (credentials file + dev console checklist).

## License

MIT
