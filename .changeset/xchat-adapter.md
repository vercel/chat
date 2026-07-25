---
"@chat-adapter/xchat": minor
"chat": patch
"create-chat-sdk": patch
---

New XChat adapter for X's encrypted messaging. All cryptography is handled inside the adapter via `@xdevplatform/chat-xdk` (wasm) and all REST goes through the typed `@xdevplatform/xdk` client.

- Encrypted send/receive in DMs and groups (webhook push + polling), signature verification on by default; undecryptable or unverified events are dropped
- Mention detection from structured mention entities, swipe-replies to the bot, and a plain-text `@handle` fallback; group replies sent as quoted replies
- `openDM(userId)` starts (or reuses) an encrypted 1:1, running a full key exchange when needed so the bot can message first
- Media both ways: inbound attachments with lazy download+decrypt, outbound encrypted uploads
- Edit and delete of the bot's own messages; the first edit of a fresh message is age-gated by `editSafetyDelayMs` (default 5000ms) so receiving clients have stored the original
- Reactions in and out, read receipts (`sendReadReceipts`, default on), typing keep-alive, configurable group welcome message
- Cards degrade to text with tappable URL/mention entities plus a URL preview attachment
- Registered in the `chat/adapters` catalog and the `create-chat-sdk` CLI scaffold
