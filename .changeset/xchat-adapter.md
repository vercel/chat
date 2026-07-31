---
"@chat-adapter/x": minor
"chat": patch
"create-chat-sdk": patch
---

Add XChat support to `@chat-adapter/x`, shipped from the new `@chat-adapter/x/chat` subpath so it sits alongside the existing X adapter. The XChat crypto stack (`@xdevplatform/chat-xdk`, `@xdevplatform/xdk`, `juicebox-sdk`) is an optional peer dependency, so existing `@chat-adapter/x` users are unaffected. All cryptography is handled inside the adapter via `@xdevplatform/chat-xdk` (wasm) and all REST goes through the typed `@xdevplatform/xdk` client. Only a bot token and a Juicebox PIN are required: the bot's identity (user id and @handle) is resolved from `GET /2/users/me` at startup.

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
