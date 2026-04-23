# LarkAdapter smoke tests

Scenario-based scripts to exercise the adapter end-to-end against a real Lark
app. Each script is a standalone `tsx` entry that boots the adapter, registers
a narrow handler, and prints what to do in Lark at startup.

## Setup

1. Create a Lark self-build app, enable the bot, subscribe to
   `im.message.receive_v1`, choose **long-connection** as the event
   delivery mode, grant `im:message` / `im:message.group_msg` /
   `im:message.p2p_msg` / `im:message:send_as_bot`, then **publish a version**.
2. Add the bot to a test group, or open a DM with it from the Lark client.
3. Create `smokes/credentials.local.ts` with your Lark app credentials.
   The file is gitignored:

   ```ts
   // smokes/credentials.local.ts
   export const APP_ID = "cli_your_app_id";
   export const APP_SECRET = "your_app_secret";
   ```

   Alternatively, export `LARK_APP_ID` / `LARK_APP_SECRET` as env vars.

## Smokes

Run any one at a time. All accept `Ctrl-C` for clean shutdown.

| Command | What it does | What to do in Lark |
|---|---|---|
| `pnpm smoke:echo` | Echo bot — answers @mentions, DMs, and subscribed-thread follow-ups | @ the bot in a group, or DM it, or keep chatting in a subscribed thread |
| `pnpm smoke:stream` | Streams a canned multi-chunk reply back (cardkit typewriter) | @ the bot; watch the reply render progressively |
| `pnpm smoke:edit` | Posts "hello v1" → edits to v2 after 3s → deletes after another 3s | @ the bot once; watch the message mutate then disappear |
| `pnpm smoke:reactions` | Posts a message, adds 👍, removes after 5s. Also logs any reaction users add | @ the bot (to trigger the demo), then add emoji to any message (to test inbound) |
| `pnpm smoke:long` | Posts a ~6000-char markdown with code blocks | @ the bot; reply should split into multiple posts without breaking code fences |
| `LARK_TEST_CHAT_ID=oc_xxx pnpm smoke:history` | One-shot: fetchMessages + listThreads + fetchMessage from the given chat | Get the chat_id from the startup log of `smoke:echo` ("bot is a member of N chats") |

All commands prefix with `--filter @chat-adapter/lark` if run from repo root,
e.g. `pnpm --filter @chat-adapter/lark smoke:stream`.

## What's exercised by each

| Smoke | Adapter method | Inbound path | Outbound path |
|---|---|---|---|
| echo | — | message → onNewMention / onDirectMessage / onSubscribedMessage | postMessage |
| stream | stream | message → onNewMention | channel.stream (cardkit) |
| edit | editMessage, deleteMessage | message → onNewMention | postMessage → editMessage → deleteMessage |
| reactions | addReaction, removeReaction | message + reaction events | postMessage → addReaction → removeReaction |
| long | — | message → onNewMention | postMessage with chunking |
| history | fetchMessages, listThreads, fetchMessage | — | `im.v1.messages.{list,get}` → SDK normalize |

## Troubleshooting

- **No events received after WS connects**: you missed a step in the dev
  console. Double-check that the subscription mode is long-connection and
  that you published a new version after changing the subscription config.
- **`safety: drop stale message`**: wasn't this fixed? The SDK still drops
  anything older than `staleMessageWindowMs` (30 min default); our adapter
  sets it to `Number.MAX_SAFE_INTEGER` to disable. If you see this, the
  SDK config isn't reaching the channel (bug).
- **`No handlers matched`**: your handler filter didn't match. Check
  chatType, mentionedBot, and subscription state in the log.
