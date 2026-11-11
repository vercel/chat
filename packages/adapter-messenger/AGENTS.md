# AGENTS.md: `@chat-adapter/messenger`

Guidance for coding agents working inside the Messenger adapter
package. Read the top-level repository [AGENTS.md](../../AGENTS.md)
first for monorepo-wide build, lint, and release rules. This file
documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/messenger` connects a Chat SDK bot to Facebook
Messenger through the Meta Messenger Platform. It covers:

- A webhook handler for the GET subscription check and signed POST
  event delivery (HMAC-SHA256 with `appSecret`).
- Outbound messages through the Send API: plain text, or one generic
  or button template built from a card.
- Typing indicators and read receipts through sender actions.
- An in-memory message history, because the Graph API has no endpoint
  for listing past messages.

Every thread is a 1:1 conversation between the page and one user.

The adapter does not send files or attachments, quick replies, or
message tags, and it has no persistent menu or Get Started setup.
Editing, deleting, and reacting are not supported by the platform API
and throw `ValidationError`.

## Directory layout

```
packages/adapter-messenger/
├── src/
│   ├── index.ts             # MessengerAdapter + createMessengerAdapter
│   ├── index.test.ts
│   ├── cards.ts             # CardElement → generic/button template or text
│   ├── cards.test.ts
│   ├── fetch.ts             # host-restricted download for inbound attachments
│   ├── fetch.test.ts
│   ├── markdown.ts          # MessengerFormatConverter (mdast ↔ markdown string)
│   ├── markdown.test.ts
│   ├── subclass.test-d.ts   # type tests for the protected subclassing surface
│   └── types.ts             # config, thread ID, Send API, and webhook typings
├── CHANGELOG.md
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
pnpm --filter @chat-adapter/messenger build
pnpm --filter @chat-adapter/messenger test
```

Tests resolve `@chat-adapter/shared` from its `dist`. Rebuild the
shared package after you change it, or run tests through `pnpm test`
at the repo root, which builds first.

The replay test is
`packages/integration-tests/src/replay-messenger.test.ts`. It reads
`packages/integration-tests/fixtures/replay/dm/messenger.json` and
uses the helpers in `packages/integration-tests/src/messenger-utils.ts`.

## Public surface

Exports from `src/index.ts`:

- `createMessengerAdapter(config?)`: the factory. It reads
  `FACEBOOK_APP_SECRET`, `FACEBOOK_PAGE_ACCESS_TOKEN`, and
  `FACEBOOK_VERIFY_TOKEN` when the matching config field is missing,
  and throws `ValidationError` if any of the three is absent from
  both.
- `MessengerAdapter`: implements
  `Adapter<MessengerThreadId, MessengerRawMessage>`. The class
  constructor does not validate its config. Only the factory does.
- `cardToMessenger`, `cardToMessengerText`,
  `encodeMessengerCallbackData`, `decodeMessengerCallbackData`,
  `MessengerFormatConverter`.
- Types: `MessengerAdapterConfig`, `MessengerThreadId`,
  `MessengerRawMessage`, `MessengerCardResult`, and the Send API and
  webhook typings from `types.ts`.

`MessengerAdapterConfig` fields: `appSecret`, `pageAccessToken`,
`verifyToken`, `apiVersion` (defaults to `v21.0`), `userName`, and
`logger`.

Public methods on `MessengerAdapter`:

- Working: `initialize`, `handleWebhook`, `postMessage`, `stream`,
  `startTyping`, `markAsRead`, `fetchMessages`, `fetchMessage`,
  `fetchThread`, `fetchChannelInfo`, `openDM`, `isDM`,
  `channelIdFromThreadId`, `encodeThreadId`, `decodeThreadId`,
  `parseMessage`, `renderFormatted`.
- Always throw `ValidationError`: `editMessage`, `deleteMessage`,
  `addReaction`, `removeReaction`.

Most internals are `protected` so that subclasses can override them,
for example `verifySignature`, `handleIncomingMessage`,
`graphApiFetch`, `compareMessages`, and `messageSequence`.
`subclass.test-d.ts` pins that surface. Keep it in sync when you add
or rename a protected member.

## Thread ID format

```
messenger:{recipientId}
```

`MessengerThreadId` is `{ recipientId: string }`. `decodeThreadId`
throws `ValidationError` unless the ID has exactly two `:`-separated
parts and the `messenger` prefix.

A thread and its channel are the same thing:
`channelIdFromThreadId` returns the thread ID unchanged. `openDM`
encodes the user ID without calling the API. `isDM` always returns
`true`.

## Webhook flow

`MessengerAdapter.handleWebhook(request, options)` is the entry
point.

1. **Subscription check** (GET). `verifyMetaWebhookChallenge` from
   `@chat-adapter/shared` requires `hub.mode=subscribe` and a
   `hub.verify_token` equal to `verifyToken`. The adapter responds
   with 200 and the `hub.challenge` value, or 403.
2. **Event delivery** (POST). `verifyMetaSignature` checks the
   `X-Hub-Signature-256` header against the raw body. The header must
   be `sha256=` followed by exactly 64 hex digits. A rejected
   signature gets 403. If the check throws, `verifySignature` logs a
   warning and treats the signature as rejected.
3. **Other responses.** Invalid JSON gets 400. A payload whose
   `object` is not `page` gets 404. Everything else gets 200 with
   `EVENT_RECEIVED`, including when the adapter isn't initialized.
4. **Event routing.** The adapter loops over every `entry[]` and
   every `messaging[]` event:
   - `message` without `is_echo`: cached, then
     `chat.processMessage`. Every inbound message has
     `isMention: true`.
   - `message` with `is_echo`: cached under the recipient's thread
     only. Chat is not called.
   - `postback`: `chat.processAction`, with the payload decoded by
     `decodeMessengerCallbackData`.
   - `reaction`: `chat.processReaction`. `added` is true when the
     action is `react`.
   - `delivery` and `read`: logged at debug level.
   - `message.quick_reply` has no special handling. The message is
     processed as ordinary text.
5. **`waitUntil`.** The adapter passes `options` to the `process*`
   calls and doesn't await them, so the 200 returns immediately and
   Chat registers the background work.

## Authentication

- **Page access token.** Sent as the `access_token` query parameter
  on every Graph API call. Never log request URLs.
- **App secret.** Used only for webhook signature verification.

`initialize` calls `GET me` to set `botUserId` and, when `userName`
wasn't configured, the bot's name. A failure there only logs a
warning.

## Format conversion

`MessengerFormatConverter` (in `markdown.ts`) is a Markdown round
trip. `fromAst` stringifies the mdast tree to Markdown and trims it,
and `toAst` parses Markdown. It does not flatten formatting to plain
text.

Outbound text has a 2000-character limit. Longer text is truncated to
1997 characters plus `...`. It is not split across messages. Empty or
whitespace-only text throws `ValidationError`. Emoji placeholders are
converted to Unicode before sending.

`stream()` buffers every chunk and posts a single message.

## Cards (templates)

`cardToMessenger` in `cards.ts` picks the output in this order:

1. **Text fallback** when the card contains a table, a `select`, or
   a `radio_select` anywhere, including inside sections.
2. Buttons come from the first actions element, found with
   `findCardActions` from `@chat-adapter/shared`. Only buttons with
   an `id` and link buttons are kept, and only the first 3.
3. **Generic template** when there is at least one button and the
   card has a `title` or an `imageUrl`.
4. **Button template** when there is at least one button and
   non-empty body text.
5. **Text fallback** otherwise.

Limits, applied by truncating with `truncateWithEllipsis`: 20
characters for a button title, 80 for a title, 80 for a subtitle, and
640 for button-template text. Extra buttons and long labels are cut.
They don't trigger the text fallback.

`<LinkButton>` becomes a `web_url` button. `<Button>` becomes a
`postback` button whose payload is `chat:{"a":"<id>","v":"<value>"}`,
built by the shared callback data codec. `decodeMessengerCallbackData`
returns the action ID `messenger_callback` for a missing payload and
passes any payload without the `chat:` prefix through as both the
action ID and the value.

## Attachments

There is no outbound file or attachment support. `postMessage` reads
only the text and the card from a postable message.

Inbound attachments that carry a `payload.url` become Chat SDK
`Attachment`s. `image`, `video`, and `audio` keep their type, and
everything else becomes `file`. `fetchData` downloads through
`download()` in `fetch.ts`, which only allows hosts under `fbsbx.com`
and `fbcdn.net`.

## Message history

`fetchMessages` and `fetchMessage` read from a per-instance,
in-memory cache keyed by thread ID. Inbound messages, echoes,
`parseMessage`, and the adapter's own sends all write to it through
`cacheMessage`.

- `cacheMessage` uses `upsertMessage` from `@chat-adapter/shared`,
  which replaces by message ID and keeps the list sorted. It expects
  a list that is already sorted by the same comparator, so every
  write must go through `cacheMessage`.
- Order is send time, then `messageSequence(id)`, the trailing
  `:{n}` of the message ID. Subclasses can override
  `messageSequence` or `compareMessages`.
- `paginateMessages` pages with message-ID cursors. The limit
  defaults to 50 and is clamped to 1..100.

The cache is lost on restart and isn't shared between instances.

## Messenger quirks worth remembering

- **Messaging window.** Every send uses
  `messaging_type: "RESPONSE"`. The adapter doesn't track the
  24-hour window or support message tags, so a send outside the
  window fails with whatever error the Graph API returns.
- **Reactions are receive-only.** The emoji is normalized with
  `defaultEmojiResolver` in `index.ts`.
- **Several events per request.** Iterate the whole
  `entry[].messaging[]` array. The routing checks are independent, so
  one event can match more than one.
- **Error bodies aren't always JSON.** `graphApiFetch` maps a failed
  response by status even when the body can't be parsed, and reports
  a parse failure only for a 2xx.

## Testing approach

- **Unit tests** sit next to each module (`*.test.ts`). `fetch` is
  stubbed with `vi.stubGlobal`. Never call `graph.facebook.com` from
  unit tests.
- **Signed requests.** A test for a rejected signature must send a
  well-formed `sha256=<64 hex>` header signed with the wrong secret
  or for another body. A malformed header is rejected earlier, for a
  different reason.
- **Card limits.** Assert the exact output at the limit and one past
  it. A length check alone passes for the wrong reason.
- **Replay test** in
  `packages/integration-tests/src/replay-messenger.test.ts` consumes
  a recorded webhook session.

The package has no `sample-messages.md` yet. When you add support for
a new event type, record a real payload in one, as the root
`AGENTS.md` asks of adapter packages.

## Coding conventions

- Use named exports throughout. No default exports.
- Send API and webhook typings live in `types.ts`. Extend them
  instead of adding a third-party dependency.
- Graph API failures go through `throwMetaGraphApiError` from
  `@chat-adapter/shared`: 429 and Meta codes 4, 32, and 613 map to
  `AdapterRateLimitError` (with `retryAfter` from the `Retry-After`
  header), 401 and code 190 to `AuthenticationError`, 403 and codes
  10 and 200 to `ValidationError`, 404 to `ResourceNotFoundError`,
  and anything else to `NetworkError`.
- Webhook verification, callback data, card helpers, and the message
  cache helpers are shared with Instagram and WhatsApp. Change them
  in `packages/adapter-shared`, not here.
- Top-level regex literals only.
- Page access tokens are sensitive. Never log them or include them in
  error messages.

## Releases

Behavioral changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/messenger`). All packages release together in one
fixed group, so you don't need to add `chat`. Tests-only and
AGENTS.md edits don't need one.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/messenger.mdx`](../../apps/docs/content/adapters/official/messenger.mdx)
- README: [`packages/adapter-messenger/README.md`](README.md)
- Shared helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core `Adapter` interface: [`packages/chat/src/types.ts`](../chat/src/types.ts)
