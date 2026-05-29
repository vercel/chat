# AGENTS.md — `@chat-adapter/whatsapp`

Guidance for coding agents working inside the WhatsApp adapter
package. The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/whatsapp` connects a Chat SDK bot to the WhatsApp Cloud
API (Meta-hosted Business Platform). It covers:

- HTTP webhook endpoint at `/api/webhooks/whatsapp` with the GET
  challenge handshake plus the POST event delivery (signed by Meta
  with HMAC-SHA256).
- Outbound messages via the Cloud API: text, media (image, document,
  video, audio, sticker), interactive (buttons, lists), templates,
  reactions, and read receipts.
- Phone-number-driven addressing — WhatsApp threads are 1:1 between
  the bot's phone number and the customer's E.164 number.
- 24-hour conversation window — outside it, only approved templates
  can be sent.
- Multiple phone-number-id support (run a single bot across multiple
  WhatsApp Business Accounts).

## Directory layout

```
packages/adapter-whatsapp/
├── src/
│   ├── index.ts             # WhatsAppAdapter + createWhatsAppAdapter
│   ├── index.test.ts
│   ├── cards.ts             # PostableMessage / Card → interactive payloads
│   ├── cards.test.ts
│   ├── markdown.ts          # WhatsAppFormatConverter (mdast ↔ WA formatting)
│   ├── markdown.test.ts
│   └── types.ts             # Cloud API typings
├── sample-messages.md       # captured Cloud API webhook events
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
pnpm --filter @chat-adapter/whatsapp build
pnpm --filter @chat-adapter/whatsapp test
```

Replay tests live in
`packages/integration-tests/src/replay-whatsapp-*.test.ts`.

## Public surface

Main exports from `src/index.ts`:

- `createWhatsAppAdapter(config?)` — primary factory. Auto-detects
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and the
  optional `WHATSAPP_WABA_ID` (used for cross-number reads).
- `WhatsAppAdapter` class — implements `Adapter<WhatsAppThreadId,
  unknown>`. Public methods: `handleWebhook`, `postMessage`,
  `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`,
  `startTyping`, `markRead`, `fetchThread`, `fetchMessages`,
  `fetchSingleMessage`, `fetchChannelInfo`, `postChannelMessage`,
  `openDM`, `sendTemplate`.
- Configuration: `WhatsAppAdapterConfig`, `WhatsAppThreadId`,
  `WhatsAppTemplateMessage`.
- Helpers: `cardToInteractive`, `cardToFallbackText`,
  `WhatsAppFormatConverter`, `decodeThreadId`, `encodeThreadId`,
  `isDM`.

## Thread ID format

WhatsApp threads are scoped by the bot's phone-number-id and the
customer's E.164 number (without the leading `+`):

```
whatsapp:{phoneNumberId}:{customerPhone}
```

`isDM(threadId)` always returns `true` — WhatsApp Cloud API has no
group concept (groups exist only on the on-prem API and are not
supported by this adapter).

## Webhook flow

`WhatsAppAdapter.handleWebhook(request, options)` is the entry point.

1. **Verification handshake** (GET) — Meta sends
   `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. The
   adapter checks `verify_token` against `WHATSAPP_VERIFY_TOKEN` and
   echoes the challenge.
2. **Event delivery** (POST) — Meta signs every body with HMAC-SHA256
   using `appSecret`. The adapter verifies before parsing.
3. **Event routing**
   - `messages` (`text`, `image`, `audio`, `document`, `video`,
     `sticker`, `location`, `interactive`, `button`) →
     `chat.handleIncomingMessage`. Mentions are detected by matching
     the bot's display phone number against `text.body`.
   - `statuses` (`sent`, `delivered`, `read`, `failed`) → optional
     delivery hooks. The adapter keeps a `lastUserMessageAt` cache so
     it can decide when the 24-hour window has expired.
   - `errors` → `chat.logger.error` with the Cloud API error
     payload.
4. **`waitUntil`** — the 200 response must land within 20 s; longer
   work goes through `waitUntil`.

## Authentication

Two flavours of access token:

- **System User token** — long-lived, recommended. Generate via
  Business Manager → System Users → token assignment for the
  WhatsApp Business product.
- **App user token** — short-lived (60 days). Use for development
  only.

The adapter never refreshes tokens; rotate them out-of-band when
they expire and update `WHATSAPP_ACCESS_TOKEN`.

## Format conversion

WhatsApp uses a small set of formatting markers: `*bold*`, `_italic_`,
`~strike~`, `` `inline code` ``, and triple-backtick code fences.
`WhatsAppFormatConverter` (in `markdown.ts`):

- mdast → WA formatting — preserves the supported markers and strips
  unsupported ones (headings collapse to bold lines, lists become
  plain paragraphs with bullet prefixes).
- WA formatting → mdast — round-trips the same constructs. Mentions
  are not recognised by the Cloud API except in a very limited
  context (`Hey @[+1234567890]`), so the converter treats them as
  plain text.
- Tables flatten to fixed-width text in a code fence.

## Cards (interactive payloads)

WhatsApp supports two interactive shapes that map onto Chat SDK
cards:

- **Reply buttons** — up to 3 buttons. `cardToInteractive` builds an
  `interactive.type: "button"` message when the card has 1–3
  `<Button>` children with no `<Select>`.
- **List messages** — up to 10 sections, each with up to 10 rows.
  Used when the card has more than 3 actions or any `<Select>`.

Outside those shapes, cards fall back to plain text built from
`cardToFallbackText`. LinkButton becomes plain text with the URL
appended; WhatsApp interactive buttons cannot open links directly,
so the adapter inlines the URL into the body.

## Templates

Outside the 24-hour conversation window, the Cloud API only accepts
**approved templates**. `sendTemplate` is the way to drive them:

```typescript
await adapter.sendTemplate(threadId, {
  name: "appointment_reminder",
  language: "en",
  components: [
    {
      type: "body",
      parameters: [{ type: "text", text: "Tomorrow at 2pm" }],
    },
  ],
});
```

The adapter does not auto-substitute templates for outbound text
posts — handlers must opt in explicitly when they detect the window
is closed.

## File uploads

`postMessage` accepts `FileUpload`. The adapter:

1. Calls `POST /{phoneNumberId}/media` with the binary content to
   obtain a `media_id`.
2. References the `media_id` in the outbound message.

Media IDs expire after 30 days. For inbound media, the adapter
exposes a lazy `fetchData()` that downloads the binary on demand.

## Streaming

WhatsApp does not support message edits via the Cloud API in the
free tier (paid tiers added support late 2024). The adapter falls
back to the buffered streaming pattern: accumulate the stream and
post once when it completes. For markets with edit support, set
`enableEdit: true` in the adapter config to switch to post-then-edit.

## WhatsApp quirks worth remembering

- **24-hour window.** Free-form messages fail outside it with a
  131047 error. Use approved templates to re-engage.
- **Phone-number formatting.** Cloud API expects E.164 without the
  leading `+`. `decodeThreadId` already handles this; raw API users
  must too.
- **Webhook signature includes the entire body.** Forwarding through
  a proxy that mutates the body breaks verification.
- **Read receipts** are sent via `messages` API with `status:
  "read"`. The adapter exposes `markRead(threadId)` for handlers
  that want explicit control.
- **Stickers, voice notes, and PDFs** all arrive as separate event
  shapes — extend `index.ts` thoughtfully when adding support.
- **Interactive button limits.** 3 reply buttons, 20-character
  labels, 256-character `id`s. The adapter throws `ValidationError`
  before sending if you exceed them.

## Testing approach

- **Unit tests** colocated with each module (`*.test.ts`). The
  interactive-payload tests in `cards.test.ts` cover reply buttons
  vs lists vs fallback text.
- **Replay tests** in
  `packages/integration-tests/src/replay-whatsapp-*.test.ts` consume
  recorded `messages` and `statuses` events.
- **Cloud API client** is mocked at the `fetch` boundary; never hit
  `graph.facebook.com` from unit tests.

When you add support for a new event subtype, capture a fresh fixture
in `sample-messages.md`.

## Coding conventions

- Use named exports throughout. No default exports.
- Cloud API typings live in `types.ts`. Extend them rather than
  pulling a third-party dependency.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `AdapterRateLimitError`, `NetworkError`, `ValidationError`).
- Top-level regex literals only.
- Phone-number sanitization belongs in one helper — never inline
  `replace(/\\+/, "")` calls.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/whatsapp` plus `chat` if a public type changed).
Sample fixtures and AGENTS.md edits don't.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/whatsapp.mdx`](../../apps/docs/content/adapters/official/whatsapp.mdx)
- README: [`packages/adapter-whatsapp/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-whatsapp/sample-messages.md`](sample-messages.md)
