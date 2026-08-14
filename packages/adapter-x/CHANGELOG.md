# @chat-adapter/x

## 4.38.0

### Minor Changes

- 18d4a23: Add a shared thread API for marking messages as read across WhatsApp, Messenger, and XChat.

  Note for anyone calling `XchatAdapter.markAsRead()` directly: it now rejects when a receipt fails instead of logging a warning and resolving. Automatic read receipts are unaffected, since the adapter still catches and logs those internally. If you call the method yourself without awaiting it, add a `.catch()` so a failed receipt does not surface as an unhandled rejection.

### Patch Changes

- 745fdf5: respect Telegram streaming rate limits and target XChat read receipts exactly
- Updated dependencies [0f24cc3]
- Updated dependencies [bdeb2bf]
- Updated dependencies [a0cba02]
- Updated dependencies [83ede7e]
- Updated dependencies [18d4a23]
  - chat@4.38.0
  - @chat-adapter/shared@4.38.0

## 4.37.0

### Patch Changes

- b674923: Restrict the X CRC challenge to the opaque token shape X sends before signing it. The endpoint previously returned an HMAC over any `crc_token`, which let a caller have an arbitrary webhook body signed and replay that as `x-twitter-webhooks-signature` on a forged POST. A webhook body is JSON and can no longer pass the token check, so a CRC response can't double as a POST event signature.
- Updated dependencies [2a2b2c5]
- Updated dependencies [4ac0455]
- Updated dependencies [0ec6a73]
- Updated dependencies [85e3d22]
  - chat@4.37.0
  - @chat-adapter/shared@4.37.0

## 4.36.0

### Minor Changes

- caa6325: Add XChat support to `@chat-adapter/x`, shipped from the new `@chat-adapter/x/chat` subpath so it sits alongside the existing X adapter. The XChat crypto stack (`@xdevplatform/chat-xdk`, `@xdevplatform/xdk`, `juicebox-sdk`) is an optional peer dependency, so existing `@chat-adapter/x` users are unaffected. All cryptography is handled inside the adapter via `@xdevplatform/chat-xdk` (wasm) and all REST goes through the typed `@xdevplatform/xdk` client. Only a bot token and a Juicebox PIN are required: the bot's identity (user id and @handle) is resolved from `GET /2/users/me` at startup.

  - Encrypted send/receive in DMs and groups (webhook push + polling), signature verification on by default; undecryptable or unverified events are dropped
  - Webhook POSTs must carry a valid `x-twitter-webhooks-signature`, which X sends on every delivery. Set `consumerSecret` (or `X_CONSUMER_SECRET`) to receive webhooks, or `disableWebhookVerification` when an upstream layer already verifies them. Polling deployments are unaffected
  - Mention detection from structured mention entities, swipe-replies to the bot, and a plain-text `@handle` fallback; group replies sent as quoted replies
  - `openDM(userId)` starts (or reuses) an encrypted 1:1, running a full key exchange when needed so the bot can message first
  - Media both ways: inbound attachments with lazy download+decrypt, outbound encrypted uploads
  - Edit and delete of the bot's own messages; the first edit of a fresh message is age-gated by `editSafetyDelayMs` (default 5000ms) so receiving clients have stored the original
  - Reactions in and out, read receipts (`sendReadReceipts`, default on), typing keep-alive, configurable group welcome message
  - Cards degrade to text with tappable URL/mention entities plus a URL preview attachment
  - Requests carry a `chat-sdk-xchat/<version>` User-Agent product token so Chat SDK traffic is identifiable in X API request logs (a User-Agent set via `apiHeaders` takes precedence)
  - Registered in the `chat/adapters` catalog and the `create-chat-sdk` CLI scaffold, with a new optional `importPath` catalog field for adapters that ship on a subpath

### Patch Changes

- Updated dependencies [257a32d]
- Updated dependencies [c5d86b1]
- Updated dependencies [0153a39]
- Updated dependencies [b547f45]
- Updated dependencies [caa6325]
  - chat@4.36.0
  - @chat-adapter/shared@4.36.0

## 4.35.0

### Patch Changes

- Updated dependencies [80def3a]
- Updated dependencies [4cb7e5d]
- Updated dependencies [46681f5]
- Updated dependencies [93a58af]
- Updated dependencies [25f3099]
  - chat@4.35.0
  - @chat-adapter/shared@4.35.0

## 4.34.0

### Minor Changes

- 4bca64f: add image upload support to X posts and DMs via the chunked media upload endpoints

### Patch Changes

- Updated dependencies [5c926f1]
- Updated dependencies [2531a42]
- Updated dependencies [1721fa0]
- Updated dependencies [4717a38]
- Updated dependencies [6714efc]
  - chat@4.34.0
  - @chat-adapter/shared@4.34.0

## 4.33.0

### Minor Changes

- ef2542c: add X (Twitter) adapter: reply to public mentions, send and receive direct messages, post and edit from the bot account, and like posts, using the X API v2 with OAuth 2.0 and managed token refresh

### Patch Changes

- Updated dependencies [3abdc69]
- Updated dependencies [0b63791]
- Updated dependencies [0c761f1]
- Updated dependencies [ef2542c]
- Updated dependencies [24a04d5]
- Updated dependencies [d4c52ca]
- Updated dependencies [076fe5d]
  - chat@4.33.0
  - @chat-adapter/shared@4.33.0
