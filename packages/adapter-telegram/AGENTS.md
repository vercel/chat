# AGENTS.md — `@chat-adapter/telegram`

Guidance for coding agents working inside the Telegram adapter
package. The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/telegram` connects a Chat SDK bot to a Telegram bot
account via the official Bot API. It covers:

- HTTP webhook endpoint at `/api/webhooks/telegram` (or polling for
  long-running processes), validated with the optional `secret_token`
  header.
- Inline keyboards for buttons (cards/actions are rendered as a text
  body plus an inline keyboard footer).
- Native message edits — Telegram supports per-message edits, which
  pairs nicely with streaming.
- Reactions, typing indicators, file uploads (photo, document,
  animation, video), and forwarded message handling.
- Group chats with optional topic threads (Forums) and direct
  messages.

## Directory layout

```
packages/adapter-telegram/
├── src/
│   ├── index.ts             # TelegramAdapter + createTelegramAdapter
│   ├── index.test.ts
│   ├── cards.ts             # Card → text + inline keyboard
│   ├── cards.test.ts
│   ├── markdown.ts          # TelegramFormatConverter (mdast ↔ MarkdownV2)
│   ├── markdown.test.ts
│   └── types.ts             # Bot API typings
├── sample-messages.md       # captured Telegram updates
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/telegram build
pnpm --filter @chat-adapter/telegram test
```

Replay tests live in
`packages/integration-tests/src/replay-telegram-*.test.ts`.

## Public surface

Main exports from `src/index.ts`:

- `createTelegramAdapter(config?)` — primary factory. Auto-detects
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and the optional
  `TELEGRAM_BOT_USERNAME` (used for mention detection in groups).
- `TelegramAdapter` class — implements `Adapter<TelegramThreadId,
  unknown>`. Public methods: `handleWebhook`, `postMessage`,
  `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`,
  `startTyping`, `fetchThread`, `fetchMessages`, `fetchSingleMessage`,
  `fetchChannelInfo`, `postChannelMessage`, `openDM`, `setWebhook`,
  `deleteWebhook`, `getMe`.
- Configuration: `TelegramAdapterConfig`, `TelegramThreadId`.
- Helpers: `cardToTelegramMessage`, `cardToFallbackText`,
  `TelegramFormatConverter`, `decodeThreadId`, `encodeThreadId`,
  `isDM`.

## Thread ID format

Telegram chats are identified by numeric `chat_id`. Forum threads
(Telegram's term for topic threads) carry a `message_thread_id`. The
adapter encodes both:

```
telegram:{chatId}                       # plain chat / DM
telegram:{chatId}:{messageThreadId}     # topic in a forum group
```

`isDM(threadId)` returns `true` when `chat.type === "private"`.

## Webhook flow

`TelegramAdapter.handleWebhook(request, options)` is the entry point.

1. **Secret token verification** — when `webhookSecret` is configured,
   the adapter checks the `X-Telegram-Bot-Api-Secret-Token` header
   with a timing-safe comparison.
2. **Update routing**
   - `message` → `chat.handleIncomingMessage`. Mentions are detected
     by walking `entities[].type === "mention"` and matching the bot's
     `@username`.
   - `edited_message` → optional `onMessageEdit` hook.
   - `callback_query` → `chat.handleAction` (inline keyboard
     callbacks).
   - `inline_query` / `chosen_inline_result` → optional inline-mode
     hooks.
   - `message_reaction` → `chat.handleReaction`.
   - `my_chat_member` / `chat_member` → membership change hooks.
3. **`waitUntil`** — outbound API calls (`sendMessage`,
   `editMessageText`, etc.) run inside `waitUntil` so the webhook
   response lands quickly.

## Format conversion

Telegram supports two markup modes: `MarkdownV2` (strict, with many
escapes required) and `HTML`. `TelegramFormatConverter` (in
`markdown.ts`) targets `MarkdownV2`:

- mdast → MarkdownV2 — escapes the 18 reserved characters
  (`_*[]()~\`>#+-=|{}.!`) inside text nodes, preserves emphasis
  (`*bold*`, `_italic_`, `__underline__`, `~strike~`, `||spoiler||`),
  inline code (single backtick), code fences, blockquotes (`>`),
  links via `[label](url)`, and mentions via `[name](tg://user?id=…)`.
- MarkdownV2 → mdast — round-trips the same constructs. Custom emoji
  arrive as separate `entities[].type: "custom_emoji"`; the converter
  embeds them inline with their fallback text.
- Tables flatten to fixed-width code blocks (no native table support).

`renderPostable` builds the text body for outbound messages. When the
target chat type is `channel` and the bot is the channel owner, the
adapter falls back to `HTML` mode for richer rendering — a quirk
worth knowing when debugging.

## Cards (text + inline keyboard)

Telegram has no card primitive — instead, cards are rendered as a
text body with an inline keyboard footer. `cardToTelegramMessage`
emits:

- Header / section text → MarkdownV2 paragraphs in the message body.
- Image → `photo` attachment (uses `sendPhoto` instead of
  `sendMessage`).
- Fields → bulleted MarkdownV2 lines.
- Buttons → `reply_markup.inline_keyboard[][]` rows. Each button has
  either `callback_data` (callback id) or `url` (`<LinkButton>`).
- LinkButton → `url` button.
- Select → emitted as a row of buttons because Telegram has no native
  select widget. Use a modal-style flow for many options.

Tables flatten as in markdown.

## Streaming

Telegram supports per-message edits cleanly, so streaming maps onto
the post-then-edit pattern. The adapter posts a placeholder, then
edits with `editMessageText` as deltas arrive. Min edit interval
defaults to 800 ms to stay under the per-bot rate limit.

## File uploads

`postMessage` accepts `FileUpload` objects (`{ filename, content,
contentType }`). The adapter picks the appropriate Bot API method:

- `image/*` → `sendPhoto`.
- `video/*` → `sendVideo`.
- `audio/*` → `sendAudio` or `sendVoice` depending on the codec.
- `image/gif` → `sendAnimation`.
- Everything else → `sendDocument`.

A single message can carry one attachment plus a caption. Multiple
`files` or compatible `attachments` are sent with `sendMediaGroup`.

## Telegram quirks worth remembering

- **MarkdownV2 escapes are mandatory.** Forgetting to escape a `.` in
  user-provided text 400s the request. The converter handles this,
  but raw API users must too.
- **Privacy mode** — group bots only see messages addressed to them
  unless privacy mode is disabled via `@BotFather`. The adapter
  surfaces this gotcha in `getMe()` output.
- **Reaction set is restricted** to a small list of emoji per chat
  unless the chat is a paid premium channel. The Bot API rejects
  unsupported reactions with 400.
- **Forum topics behave like channels.** The `message_thread_id`
  needs to be passed back on every reply; otherwise the bot posts at
  the chat root.
- **`message_id` is per-chat, not global.** Persist it together with
  the `chat_id`.
- **`secret_token`** is the only line of defence for HTTP webhooks
  — do not skip configuring it in production.

## Testing approach

- **Unit tests** colocated with each module (`*.test.ts`). The
  MarkdownV2 escape tests are extensive — extend them whenever you
  touch the converter.
- **Replay tests** in
  `packages/integration-tests/src/replay-telegram-*.test.ts` consume
  recorded `Update` payloads.
- **Bot API client** is mocked at the `fetch` boundary. Never hit
  `api.telegram.org` from unit tests.

When you add support for a new update type, capture a fresh fixture
in `sample-messages.md`.

## Coding conventions

- Use named exports throughout. No default exports.
- The Bot API typings live in `types.ts` — extend them in place
  rather than pulling a third-party dependency.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `AdapterRateLimitError`, `NetworkError`, `ValidationError`).
- Top-level regex literals only — Telegram has many of them
  (`MARKDOWN_V2_ESCAPES`, `MENTION_REGEX`, etc.).
- Always escape user-provided text before concatenation. Format
  helpers (`escapeMarkdownV2`) live in `markdown.ts`.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/telegram` plus `chat` if a public type changed). Sample
fixtures and AGENTS.md edits don't.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/telegram.mdx`](../../apps/docs/content/adapters/official/telegram.mdx)
- README: [`packages/adapter-telegram/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-telegram/sample-messages.md`](sample-messages.md)
