# AGENTS.md: `@chat-adapter/whatsapp`

Guidance for coding agents working inside the WhatsApp adapter
package. Read the top-level repository [AGENTS.md](../../AGENTS.md)
first for monorepo-wide build, lint, and release rules. This file
documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/whatsapp` connects a Chat SDK bot to the WhatsApp Cloud
API (Meta-hosted Business Platform). It covers:

- A webhook handler for the GET subscription check and signed POST
  event delivery (HMAC-SHA256 with `appSecret`).
- Outbound messages through the Cloud API: text, media (image,
  document, video, audio), interactive reply buttons, CTA URL
  messages, templates, reactions, typing indicators, and read
  receipts.
- 1:1 threads between one bot phone number and one user, who is
  identified by a phone number or a business-scoped user ID (BSUID).

The adapter is configured with a single `phoneNumberId`, and every
send goes through it. It does not send list messages or stickers,
does not track the 24-hour conversation window, and has no message
history: `fetchMessages` returns an empty list. Editing and deleting
messages always throw.

## Directory layout

```
packages/adapter-whatsapp/
├── src/
│   ├── index.ts             # WhatsAppAdapter + createWhatsAppAdapter
│   ├── index.test.ts
│   ├── cards.ts             # CardElement → reply buttons, CTA URL, or text
│   ├── cards.test.ts
│   ├── errors.ts            # WhatsAppApiError (Meta Graph error envelope)
│   ├── errors.test.ts
│   ├── markdown.ts          # WhatsAppFormatConverter (mdast ↔ WA formatting)
│   ├── markdown.test.ts
│   ├── subclass.test-d.ts   # type tests for the protected subclassing surface
│   └── types.ts             # Cloud API typings
├── sample-messages.md       # captured Cloud API webhook events
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
pnpm --filter @chat-adapter/whatsapp build
pnpm --filter @chat-adapter/whatsapp test
```

Tests resolve `@chat-adapter/shared` from its `dist`. Rebuild the
shared package after you change it, or run tests through `pnpm test`
at the repo root, which builds first.

The replay test is
`packages/integration-tests/src/replay-whatsapp.test.ts`. It reads
`packages/integration-tests/fixtures/replay/dm/whatsapp.json` and
uses the helpers in `packages/integration-tests/src/whatsapp-utils.ts`.

## Public surface

Exports from `src/index.ts`:

- `createWhatsAppAdapter(config?)`: the factory. It reads
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_VERIFY_TOKEN` when the
  matching config field is missing, and throws `ValidationError` if
  any of the four is absent from both. `WHATSAPP_BOT_USERNAME`
  (defaults to `whatsapp-bot`) and `WHATSAPP_API_URL` are optional.
- `WhatsAppAdapter`: implements
  `Adapter<WhatsAppThreadId, WhatsAppRawMessage>`. The class
  constructor does not validate its config. Only the factory does.
- `WhatsAppApiError`, `splitMessage`, `getWhatsAppMediaType`,
  `validateFileSize`.
- Types: `WhatsAppAdapterConfig`, `WhatsAppThreadId`,
  `WhatsAppRawMessage`, `WhatsAppMediaType`, `WhatsAppMediaResponse`,
  `WhatsAppTemplateMessage` and its component and parameter types,
  and the `WhatsAppGraphError` / `WhatsAppGraphErrorBody` envelope
  types.

Nothing from `cards.ts` or `markdown.ts` is exported from the
package.

`WhatsAppAdapterConfig` fields: `accessToken`, `appSecret`,
`phoneNumberId`, `verifyToken`, `apiVersion` (defaults to `v25.0`),
`apiUrl` (defaults to `https://graph.facebook.com`), `userName`, and
`logger`.

Public methods on `WhatsAppAdapter`:

- Working: `initialize`, `handleWebhook`, `postMessage`, `reply`,
  `sendTemplate`, `stream`, `addReaction`, `removeReaction`,
  `startTyping`, `markAsRead`, `fetchThread`, `fetchMessages`
  (always returns `{ messages: [] }`), `openDM`, `isDM`,
  `channelIdFromThreadId`, `encodeThreadId`, `decodeThreadId`,
  `parseMessage`, `renderFormatted`, `downloadMedia`,
  `rehydrateAttachment`, `splitMessage`.
- Always throw: `editMessage`, `deleteMessage`.

The handlers and helpers that subclasses override are `protected`,
for example `verifySignature`, `handleInboundMessage`,
`handleReaction`, `handleInteractiveReply`, `handleButtonResponse`,
and `buildMessage`. `subclass.test-d.ts` pins that surface. Keep it
in sync when you add or rename a protected member.

## Thread ID format

```
whatsapp:{phoneNumberId}:{userWaId}
```

`WhatsAppThreadId` is `{ phoneNumberId: string; userWaId: string }`.
`userWaId` is the user's routing identifier, which may be a phone
number or a BSUID. `decodeThreadId` throws `ValidationError` unless
the ID has the `whatsapp` prefix and exactly two non-empty segments
after it. It does not strip a leading `+` or normalize the number in
any other way.

`isDM` always returns `true`. `channelIdFromThreadId` returns the
thread ID unchanged. `openDM` encodes the user ID with the configured
`phoneNumberId` and doesn't call the API.

## Webhook flow

`WhatsAppAdapter.handleWebhook(request, options)` is the entry point.

1. **Subscription check** (GET). `verifyMetaWebhookChallenge` from
   `@chat-adapter/shared` requires `hub.mode=subscribe` and a
   `hub.verify_token` equal to `verifyToken`. The adapter responds
   with 200 and the `hub.challenge` value, or 403.
2. **Event delivery** (POST). `verifyMetaSignature` checks the
   `X-Hub-Signature-256` header against the raw body. The header must
   be `sha256=` followed by exactly 64 hex digits. A rejected
   signature gets 401. If the check throws, `verifySignature` logs a
   warning and treats the signature as rejected.
3. **Other responses.** Invalid JSON gets 400. Everything else gets
   200 with `ok`.
4. **Event routing.** The adapter loops over every `entry[]` and
   `changes[]`:
   - `field: "messages"`, by message type:
     - `text`, `image`, `document`, `audio`, `voice`, `video`,
       `sticker`, `location`: `chat.processMessage`. Non-text types
       get placeholder text such as `[Image]`, and image and document
       captions are used as the text.
     - `interactive` (`button_reply` and `list_reply`):
       `chat.processAction`, with the reply ID decoded by
       `decodeWhatsAppCallbackData`.
     - `button` (a template quick reply): `chat.processAction` with
       the button payload as the action ID.
     - `reaction`: `chat.processReaction`. An empty emoji means the
       reaction was removed.
     - `system` (`user_changed_number`, `user_changed_user_id`):
       updates identity state, then skips dispatch.
     - Anything else is logged at debug level and ignored.
   - `field: "user_id_update"`: aliases the previous and current
     BSUID to the same canonical user so the thread survives the
     change.
   - `statuses` and any other field are ignored.
5. **`waitUntil`.** The adapter passes `options` to the `process*`
   calls and doesn't await them. Identity lookups and updates are
   awaited before the 200.

There is no mention detection. Inbound messages don't set
`isMention`.

## Authentication

The access token is sent as an `Authorization: Bearer` header on
every Graph API call, never as a query parameter. On media downloads
the token is attached only to the Graph origin and to hosts under
`fbcdn.net` and `fbsbx.com`, checked on every redirect hop.

The app secret is used only for webhook signature verification.

The adapter never refreshes tokens. Rotate them out of band and
update `WHATSAPP_ACCESS_TOKEN`.

## Format conversion

WhatsApp uses a small set of formatting markers: `*bold*`, `_italic_`,
`~strike~`, and triple-backtick code fences.
`WhatsAppFormatConverter` (in `markdown.ts`):

- mdast → WhatsApp formatting. Headings become bold lines, thematic
  breaks become `━━━`, and tables become an ASCII table in a code
  block. Lists stay Markdown lists with `-` bullets.
- WhatsApp formatting → mdast. `toAst` runs `normalizeCodeFences`
  from `@chat-adapter/shared` first, so text after an opening fence
  is code and not an info string.

The converter has no mention handling.

Outbound text has a 4096-character limit. `splitMessage` splits
longer text at paragraph breaks, then line breaks, then a hard cut,
and the adapter sends the chunks as sequential messages. The first
chunk carries the reply context and the last message ID is returned.

## Cards (interactive payloads)

`cardToWhatsApp` in `cards.ts` produces one of three results:

- **Reply buttons** (`interactive.type: "button"`). Buttons come
  from the first actions element, found with `findCardActions` from
  `@chat-adapter/shared`. Only `<Button>` children with an `id` are
  kept, and only the first 3. Extra buttons are dropped. They don't
  trigger a list or the text fallback.
- **CTA URL messages** (`interactive.type: "cta_url"`) when the
  card's only interactive element, across every actions row
  including rows nested in sections, is a single `LinkButton` with
  a non-empty label and an `http://` or `https://` URL. Promotion
  is skipped when the card has a header `imageUrl` or any image,
  table, chart, or inline link children (the interactive body
  cannot carry them), or when the post includes files or
  attachments (the captioned media send wins). Text, fields,
  sections, and dividers are fine.
- **Text** otherwise, built by `cardToWhatsAppText`, where link
  buttons render as `Label: url` and reply buttons as `[Label]`.

Limits, applied by truncating with `truncateWithEllipsis`: 20
characters for a button title or CTA `display_text`, 60 for the
header, and 1024 for the body. `cards.ts` never throws for a card
that exceeds them.

The adapter does not build list messages. The `list` interactive
shape exists only as a type, and inbound `list_reply` events are
handled.

When a card renders as reply buttons, any `LinkButton` URLs are
appended to the body as `Label: url` lines so they stay reachable.
The same lines are added to media captions, which use
`cardToFallbackText` from `@chat-adapter/shared` and so exclude
action elements.

Reply button IDs are `chat:{"a":"<id>","v":"<value>"}`, built by the
shared callback data codec. `decodeWhatsAppCallbackData` returns the
action ID `whatsapp_callback` for a missing ID and passes any ID
without the `chat:` prefix through as both the action ID and the
value.

## Templates

`sendTemplate` sends an approved template, which is what the Cloud
API accepts outside the 24-hour conversation window:

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

The adapter does not substitute templates for outbound text posts.
Handlers must opt in explicitly.

## File uploads

`postMessage` accepts both `files` (`FileUpload[]`) and `attachments`
(`Attachment[]`). Binary payloads upload via
`POST /{phoneNumberId}/media` to obtain a `media_id`; URL-only
attachments use WhatsApp link passthrough (HTTPS required, no upload).

**One media object per API message.** Multiple files or attachments
in a single `post()` call are sent as sequential messages. The last
message ID is returned (same convention as long-text chunking).

**Captions.** Markdown or card fallback text is attached as a caption
on the first media message when possible (max 1024 characters). A
separate leading text message is sent when the caption is too long,
or when the first media is `audio` (audio messages do not support
captions).

**MIME mapping.** `image/jpeg` and `image/png` map to `image`;
other `image/*` types (e.g. GIF) map to `document`. `video/mp4` and
`video/3gpp` map to `video`; `audio/*` maps to `audio`; everything
else maps to `document`. Pre-flight size checks throw
`ValidationError` when binary size is known (image 5 MB, audio/video
16 MB, document 100 MB).

**Cards + files.** When the card renders as reply buttons, media is
sent without a caption and the interactive message that follows
carries the title, body, and buttons. Text-fallback cards caption
the first media with the fallback text plus a `Label: url` line per
link button. A card with only a link button is never promoted to a
CTA URL message when media is attached; it takes this captioned
path. All media is resolved and uploaded before the first send, so a
`ValidationError` for empty data, a non-HTTPS URL, or an oversized
file is thrown before anything is sent.

For inbound media, the adapter exposes a lazy `fetchData()` that
downloads the binary on demand. `downloadMedia(mediaId, transport?)`
does the same two-step fetch directly, and `rehydrateAttachment`
rebuilds `fetchData` from stored metadata.

## Streaming

`editMessage` always throws, so `stream()` buffers: it accumulates
string and `markdown_text` chunks and posts once when the stream
completes. There is no post-then-edit mode.

## WhatsApp quirks worth remembering

- **24-hour window.** The adapter doesn't track it. A free-form
  message outside the window fails with a `WhatsAppApiError` carrying
  the Graph API's error code. Use `sendTemplate` to re-engage.
- **User identifiers.** A user may be addressed by phone number or
  by BSUID. The adapter keeps alias and route state under
  `whatsapp:identity:*` keys and picks the recipient field from it.
  Don't assume the third thread ID segment is a phone number.
- **Webhook signature covers the entire raw body.** Forwarding
  through a proxy that changes the body breaks verification.
- **Read receipts.** `markAsRead` sends `status: "read"` for a
  message ID. `startTyping` also marks the latest inbound message as
  read, because the typing indicator is attached to that call. It
  warns and returns when the thread has no inbound message yet.
- **Reactions.** Removing a reaction sends an empty emoji.
- **Stickers and voice notes** arrive as their own message types.
  PDFs arrive as `document`.
- **Malformed payloads.** `handleWebhook` doesn't guard against a
  payload without `entry` or `changes`.

## Testing approach

- **Unit tests** sit next to each module (`*.test.ts`). `fetch` is
  replaced on `globalThis`. Never call `graph.facebook.com` from unit
  tests.
- **Signed requests.** A test for a rejected signature must send a
  well-formed `sha256=<64 hex>` header signed with the wrong secret
  or for another body. A malformed header is rejected earlier, for a
  different reason.
- **Card limits.** Assert the exact output at the limit and one past
  it. A length check alone passes for the wrong reason.
- **Replay test** in
  `packages/integration-tests/src/replay-whatsapp.test.ts` consumes
  a recorded webhook session, including a status event that the
  adapter ignores.

When you add support for a new event subtype, capture a fresh fixture
in `sample-messages.md`.

## Coding conventions

- Use named exports throughout. No default exports.
- Cloud API typings live in `types.ts`. Extend them rather than
  pulling a third-party dependency.
- Every Graph API call goes through `graphFetchJson`. Non-2xx responses
  throw `WhatsAppApiError` from `errors.ts`, which maps status and Meta
  codes onto the shared `AdapterError.code` taxonomy; extend that mapping
  rather than throwing `AdapterRateLimitError` / `AuthenticationError`
  directly. Transport and JSON parse failures throw `NetworkError`, and
  bad input throws `ValidationError`.
- Webhook verification, callback data, and the card helpers
  `findCardActions` and `truncateWithEllipsis` are shared with
  Messenger and Instagram. Change them in `packages/adapter-shared`,
  not here.
- Top-level regex literals only.
- Access tokens are sensitive. Never log them or include them in
  error messages.

## Releases

Behavioral changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/whatsapp`). All packages release together in one
fixed group, so you don't need to add `chat`. Sample fixtures and
AGENTS.md edits don't need one.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/whatsapp.mdx`](../../apps/docs/content/adapters/official/whatsapp.mdx)
- README: [`packages/adapter-whatsapp/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/types.ts`](../chat/src/types.ts)
- Sample webhook payloads: [`packages/adapter-whatsapp/sample-messages.md`](sample-messages.md)
