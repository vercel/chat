# create-chat-sdk

## 0.4.0

### Minor Changes

- a0cba02: Add Vercel Connect credential resolvers and custom webhook verification to the Discord adapter, with `create-chat-sdk --connect` scaffolding for Discord bots.
- 06b04ac: Add outbound-only Vercel Connect authentication for Notion while retaining native webhook verification and scaffolding.
- 7a1150c: Add outbound-only Vercel Connect authentication for Telegram while retaining native webhook verification or polling.

## 0.3.0

### Minor Changes

- 2a2b2c5: Add a native Instagram Direct Messages adapter with signed webhooks, media, quick replies, story context, reactions, and typed Meta API errors.
- 0ec6a73: Add `@chat-adapter/notion` for Notion page and block comment discussions: webhook HMAC verification, Post+Edit streaming, conversation history, `message.subject` page metadata, plain-text `@userName`/`@botUserId` mention detection, and File Uploads (up to 3 native attachments). Registers the adapter in the `chat/adapters` catalog and `create-chat-sdk` CLI scaffold, and adds Notion emoji platform support.

## 0.2.1

### Patch Changes

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

## 0.2.0

### Minor Changes

- ba375ce: Add Vercel Connect support to the scaffolder. Pass `--connect` (or choose **Vercel Connect** at the new interactive auth-mode prompt) to authenticate the Slack, GitHub, and Linear adapters with a Vercel Connect connector instead of stored provider secrets. The generated `src/lib/bot.ts` spreads the matching helper from `@vercel/connect/chat` into the adapter factory, `@vercel/connect` is added to dependencies, and `.env.example` lists each connector UID (for example `SLACK_CONNECTOR`) plus the recommended `GITHUB_BOT_USER_ID` for GitHub, in place of native secrets.
- ef2542c: add X (Twitter) adapter: reply to public mentions, send and receive direct messages, post and edit from the bot account, and like posts, using the X API v2 with OAuth 2.0 and managed token refresh

### Patch Changes

- 3abdc69: docs(adapters): add Cloudflare Agents as a vendor-official state adapter (`agents/chat-sdk`) to the catalog and docs listing. It is hidden from the create-chat-sdk CLI (Worker/Durable Objects runtime), and the interactive state picker now filters out CLI-incompatible state adapters.
- 0c761f1: docs(adapters): add Dial as a vendor-official adapter (`@getdial/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- 24a04d5: docs(adapters): add Photon as a vendor-official adapter (`@photon-ai/chat-adapter-imessage`) to the catalog, docs listing, and CLI scaffold spec

## 0.1.1

### Patch Changes

- d034b8b: docs(adapters): add Linq as a vendor-official adapter (`@linqapp/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- 06af3e1: docs(adapters): add Novu as a vendor-official adapter (`@novu/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec

## 0.1.0

### Minor Changes

- 8f3af76: Add the `create-chat-sdk` CLI for scaffolding webhook-only Next.js Chat SDK bot projects. Supports interactive prompts, non-interactive `--adapter` selection from the `chat/adapters` catalog, coding-agent detection with an `--interactive` escape hatch, and generated `src/lib/bot.ts`, `.env.example`, `next.config.ts`, and README output per selected adapter.
