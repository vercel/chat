---
"@chat-adapter/signal": minor
"chat": minor
---

Add a new `@chat-adapter/signal` package for Signal bots powered by `signal-cli-rest-api`.

**Adapter features:**

- Incoming updates via webhook (including JSON-RPC receive payloads), REST polling (`pollOnce`/`startPolling`/`stopPolling`), and WebSocket (json-rpc mode) support
- Message send/edit/delete via `/v2/send` and `/v1/remote-delete`
- Reactions (add/remove) via `/v1/reactions`
- Typing indicators via `/v1/typing-indicator`
- File attachments (incoming metadata + lazy download, outgoing base64 data URIs)
- DM and group thread handling with `group.` prefix convention
- Cached message fetch APIs (`fetchMessages`/`fetchMessage`/`fetchChannelMessages`) matching Telegram adapter's in-memory cache style
- Message length truncation (4096 characters, matching Telegram)
- `text_mode` support (`normal`/`styled`) for Signal's markdown formatting

**Reliability & correctness:**

- Fail-fast initialization: health check (`/v1/health`) and account verification (`/v1/accounts`) during `initialize()`
- Incoming edit messages dispatched through `chat.processMessage` with stable message IDs across identity alias evolution
- Sync sent messages from linked devices routed through `chat.processMessage`
- Remote delete events remove messages from cache
- Identity canonicalization: phone number/UUID/source aliases tracked and canonicalized, preferring phone format
- Deterministic group ID normalization (inbound binary→base64, outbound validation)
- Full error mapping: 401→`AuthenticationError`, 403→`PermissionError`, 404→`ResourceNotFoundError`, 429→`AdapterRateLimitError`, 400→`ValidationError`, 5xx→`NetworkError`

**Chat SDK core changes:**

- Signal-aware user ID inference in `chat.openDM()` for `signal:...` prefixed IDs and E.164 phone numbers
- Message deduplication key includes edit revision suffix (`editedAt` timestamp) so edited messages are not swallowed as duplicates
