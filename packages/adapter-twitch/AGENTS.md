# AGENTS.md for `@chat-adapter/twitch`

Follow the repository-level `AGENTS.md` plus these package-specific rules.

## Scope

This package integrates Twitch channel chat and whispers through EventSub
webhooks and the Helix API. It runs as a Twitch "cloud chatbot": a dedicated
bot account, an app access token from the client credentials grant, and
one-time authorizations from the bot and each broadcaster. It uses the
EventSub webhook transport only, so it works on serverless platforms.

## Contracts

- Factory: `createTwitchAdapter`
- Adapter name: `twitch`
- Thread IDs: `twitch:{broadcasterUserId}` (chat room) and
  `twitch:whisper:{userId}` (whisper). A chat thread ID is also its channel ID.
- Lock scope: `channel`
- Handled EventSub types: `channel.chat.message` v1, `user.whisper.message` v1
- Required env vars: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`,
  `TWITCH_WEBHOOK_SECRET`, and `TWITCH_BOT_USERNAME` or `TWITCH_BOT_USER_ID`

## Tokens

- App access token (client credentials): EventSub subscriptions, Send Chat
  Message, Delete Chat Messages, Get Users. Cached in memory and at
  `twitch:app-token:{clientId}`; a 401 deletes both and retries once.
- User access token (`user:manage:whispers`): Send Whisper only. Static,
  provider function, or managed refresh persisted at
  `twitch:oauth:{clientId}:{botUserId}`. The stored record carries a SHA-256
  `seed` of the configured refresh token and is ignored when it doesn't match.
  A configured access token is used until a 401. A 401 retries once for
  managed and provider tokens. Re-read state before refreshing, since another
  instance may have rotated the refresh token.

## Platform constraints

- Chat messages are plain text, one line, at most 500 characters.
- Whispers are at most 500 characters to users who haven't whispered the bot
  and 10,000 otherwise; the sender needs a verified phone number. Inbound
  whisper senders are recorded at `twitch:whispered:{botUserId}:{userId}`.
- Shared chat copies (`source_broadcaster_user_id` set to another channel)
  are ignored; only the source channel's copy is handled.
- Never call Delete Chat Messages without `message_id`: Twitch clears the
  whole chat room.
- Send Chat Message can return 200 with `is_sent: false`; surface
  `drop_reason` as an error.
- Chat events carry no timestamp; use `Twitch-Eventsub-Message-Timestamp`.
- Reject notifications older than 10 minutes. Chat SDK dedupes retries by
  message ID.
- No edits, reactions, typing indicators, uploads, or history API.
  `fetchMessages` returns `[]` so Chat SDK reads the history it persists
  (`persistThreadHistory`); don't add an in-memory message cache.

## Testing

Mock `fetch`; unit tests must not call Twitch. Add payloads to
`sample-messages.md` when adding an event shape.

```bash
pnpm --filter @chat-adapter/twitch test
pnpm --filter @chat-adapter/twitch typecheck
pnpm --filter @chat-adapter/twitch build
```

Never log access tokens, refresh tokens, client secrets, the webhook secret,
or webhook signatures.
