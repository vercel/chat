# AGENTS.md — `@chat-adapter/messenger`

Guidance for coding agents working inside the Messenger adapter
package. The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/messenger` connects a Chat SDK bot to Facebook
Messenger via the Meta Messenger Platform. It covers:

- HTTP webhook endpoint at `/api/webhooks/messenger` with the GET
  challenge handshake plus signed POST event delivery (HMAC-SHA256
  via `appSecret`).
- Outbound messages via the Send API: text, attachments, templates
  (button + generic + receipt), quick replies, and persistent menu
  setup.
- Page-scoped addressing — Messenger threads are 1:1 between the
  page and a customer's PSID (page-scoped user id).
- 24-hour standard messaging window with message-tag escapes for
  certain transactional flows.

## Directory layout

```
packages/adapter-messenger/
├── src/
│   ├── index.ts             # MessengerAdapter + createMessengerAdapter
│   ├── index.test.ts
│   ├── cards.ts             # PostableMessage / Card → button/generic templates
│   ├── cards.test.ts
│   ├── markdown.ts          # MessengerFormatConverter (mdast ↔ plain text)
│   ├── markdown.test.ts
│   └── types.ts             # Send API + webhook event typings
├── sample-messages.md       # captured Messenger webhook deliveries
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

Replay tests live in
`packages/integration-tests/src/replay-messenger-*.test.ts`.

## Public surface

Main exports from `src/index.ts`:

- `createMessengerAdapter(config?)` — primary factory. Auto-detects
  `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_APP_SECRET`,
  `MESSENGER_VERIFY_TOKEN`, and the optional `MESSENGER_PAGE_ID`.
- `MessengerAdapter` class — implements `Adapter<MessengerThreadId,
  unknown>`. Public methods: `handleWebhook`, `postMessage`,
  `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`,
  `startTyping`, `markRead`, `fetchThread`, `fetchMessages`,
  `fetchSingleMessage`, `fetchChannelInfo`, `postChannelMessage`,
  `openDM`, `setPersistentMenu`, `setGetStarted`.
- Configuration: `MessengerAdapterConfig`, `MessengerThreadId`.
- Helpers: `cardToTemplate`, `cardToFallbackText`,
  `MessengerFormatConverter`, `decodeThreadId`, `encodeThreadId`,
  `isDM`.

## Thread ID format

Messenger conversations are scoped by page ID and the user's PSID:

```
messenger:{pageId}:{psid}
```

`isDM(threadId)` always returns `true` — Messenger has no group
construct exposed to bots. Group chats (Workplace) require a
different adapter.

## Webhook flow

`MessengerAdapter.handleWebhook(request, options)` is the entry
point.

1. **Verification handshake** (GET) — Meta sends the same
   `hub.verify_token` / `hub.challenge` flow as WhatsApp. The
   adapter checks `verify_token` against `MESSENGER_VERIFY_TOKEN`.
2. **Event delivery** (POST) — signed with HMAC-SHA256 using
   `appSecret`. The adapter verifies the `X-Hub-Signature-256`
   header before parsing.
3. **Event routing**
   - `messaging[].message` → `chat.handleIncomingMessage`. Mentions
     are detected via `message.mentions` (rare on Messenger; mostly
     used in group chats which we don't support).
   - `messaging[].postback` → `chat.handleAction` for persistent
     menu callbacks and Get-Started flows.
   - `messaging[].quick_reply` → `chat.handleAction` for tapped quick
     replies.
   - `messaging[].delivery` / `messaging[].read` → optional delivery
     receipts.
   - `messaging[].reaction` → `chat.handleReaction`.
4. **`waitUntil`** — required because Meta retries on slow 200s.

## Authentication

Two pieces of state per page:

- **Page Access Token** — long-lived (exchanged from a short-lived
  user token via the Graph API token-exchange endpoint). Persist it
  in your secret store.
- **App Secret** — used only for signature verification, never in
  outbound calls.

Out-of-webhook code uses the page access token directly; there's no
per-conversation state to manage.

## Format conversion

Messenger renders plain text. `MessengerFormatConverter` (in
`markdown.ts`):

- mdast → plain text — strips all formatting, preserves links by
  flattening to `label (url)` notation, preserves bullet/ordered
  list bullets via prefix characters (`• `, `1. `).
- Plain text → mdast — wraps the body in a single `paragraph` with
  links auto-detected via the URL regex.
- Tables flatten to fixed-width text.

The Send API has a 2000-character limit per message. The adapter
splits longer text into multiple messages with sensible breakpoints.

## Cards (templates)

Messenger supports several template types; the adapter chooses
based on card structure:

- **Button template** — short body + up to 3 buttons. Used when the
  card has a single section, no images, and 1–3 actions.
- **Generic template** — rich card with image, title, subtitle, and
  buttons. Used when the card has a `<Image>` child or richer
  layout.
- **Quick replies** — up to 13 inline reply chips. Used when the
  card has many short button options that fit the chip pattern.

`<LinkButton>` becomes a `web_url` button. `<Button>` becomes a
`postback` button with `payload = callbackId`.

## File uploads

The Send API accepts attachments via either upload or URL reference.
`postMessage` prefers URL references when the file is already hosted
publicly; binary uploads go through `POST
/{pageId}/message_attachments` first.

Inbound attachments arrive with public `payload.url` — surface them
to handlers as Chat SDK `Attachment`s with the URL preserved.

## Messenger quirks worth remembering

- **24-hour window.** Free-form messages outside the window require
  a `messaging_type` of `MESSAGE_TAG` with an approved tag (`HUMAN_AGENT`,
  `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`).
  The adapter throws `ValidationError` if you bypass the window
  without a tag.
- **PSID stability.** PSIDs are page-scoped — the same user has a
  different PSID on a different page.
- **Persistent menu.** `setPersistentMenu` configures the
  hamburger-style menu shown to all users; `setGetStarted` configures
  the Get Started button payload. Both are page-wide.
- **Page subscription.** The Messenger app must be subscribed to the
  page's webhooks (`POST /{pageId}/subscribed_apps`) before events
  fire. Subscription is per-page, not per-user.
- **Reactions** are limited to a small set (`smile`, `angry`, `sad`,
  `wow`, `love`, `like`, `dislike`). The adapter normalizes via
  `cards.ts`.
- **Webhook deliveries can include multiple events per request.**
  Iterate the `entry[].messaging[]` array fully.

## Testing approach

- **Unit tests** colocated with each module (`*.test.ts`). The
  template-selection tests in `cards.test.ts` are particularly
  important.
- **Replay tests** in
  `packages/integration-tests/src/replay-messenger-*.test.ts` consume
  recorded webhook events.
- **Send API client** is mocked at the `fetch` boundary; never hit
  `graph.facebook.com` from unit tests.

When you add support for a new event type, capture a fresh fixture
in `sample-messages.md`.

## Coding conventions

- Use named exports throughout. No default exports.
- Send API typings live in `types.ts`. Extend them rather than
  pulling a third-party dependency.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `AdapterRateLimitError`, `NetworkError`, `ValidationError`).
- Top-level regex literals only.
- Page access tokens are sensitive — never log them, never include
  them in serialized error messages.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/messenger` plus `chat` if a public type changed).
Sample fixtures and AGENTS.md edits don't.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/messenger.mdx`](../../apps/docs/content/adapters/official/messenger.mdx)
- README: [`packages/adapter-messenger/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-messenger/sample-messages.md`](sample-messages.md)
