# AGENTS.md — `@chat-adapter/gchat`

Guidance for coding agents working inside the Google Chat adapter
package. The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/gchat` connects a Chat SDK bot to Google Chat (the
Workspace messaging product, not Hangouts/Meet). It covers:

- HTTP webhook endpoint at `/api/webhooks/gchat`, validated with
  Google-issued JWTs.
- Card v2 rendering for cards, fields, action buttons, image
  attachments, and dialog modals.
- Workspace Events API consumption for cross-space subscriptions
  (mentions in spaces the bot isn't a direct member of).
- Service-account credentials or Application Default Credentials
  (ADC), with optional impersonation of a domain user.
- Thread-or-flat space modes — Google Chat spaces can be configured
  for top-level posts only, threaded, or both.

The adapter follows the [Google Chat API
v1](https://developers.google.com/chat/api/reference/rest) surface and
relies on `google-auth-library` for credential resolution.

## Directory layout

```
packages/adapter-gchat/
├── src/
│   ├── index.ts             # GoogleChatAdapter + createGoogleChatAdapter
│   ├── index.test.ts
│   ├── cards.ts             # PostableMessage / Card → Card v2
│   ├── cards.test.ts
│   ├── markdown.ts          # GoogleChatFormatConverter (mdast ↔ Chat formatting)
│   ├── markdown.test.ts
│   ├── thread-utils.ts      # space/thread parsing + base64url helpers
│   ├── thread-utils.test.ts
│   ├── user-info.ts         # users.get caching + display-name resolution
│   ├── user-info.test.ts
│   ├── workspace-events.ts  # Workspace Events API push handler
│   └── workspace-events.test.ts
├── sample-messages.md       # captured Chat API event payloads
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
pnpm --filter @chat-adapter/gchat build
pnpm --filter @chat-adapter/gchat test
```

Replay tests live in
`packages/integration-tests/src/replay-gchat-*.test.ts` and exercise
the full webhook → handler flow against fixtures.

## Public surface

The package's main exports (see `src/index.ts`):

- `createGoogleChatAdapter(config?)` — primary factory. Auto-detects
  `GOOGLE_CHAT_CREDENTIALS` (inline JSON or a path), falls back to ADC
  when `GOOGLE_CHAT_USE_ADC=true`, and recognises
  `GOOGLE_CHAT_SUBJECT` for domain-wide delegation.
- `GoogleChatAdapter` class — implements `Adapter<GoogleChatThreadId,
  unknown>`. Public methods: `handleWebhook`, `postMessage`,
  `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`,
  `startTyping`, `openModal`, `fetchThread`, `listThreads`,
  `fetchMessages`, `fetchSingleMessage`, `fetchChannelInfo`,
  `postChannelMessage`, `openDM`, `handleWorkspaceEvent`.
- Configuration types: `GoogleChatAdapterConfig`,
  `GoogleChatThreadId`, `GoogleChatCredentials`.
- Helpers: `cardToCardV2`, `cardToFallbackText`,
  `GoogleChatFormatConverter`, `decodeThreadId`, `encodeThreadId`,
  `isDM`.

## Thread ID format

Google Chat space and thread names contain forward slashes (e.g.
`spaces/AAA…/threads/BBB…`), so the adapter base64url-encodes them.

```
gchat:{space_base64url}                      # flat post in a space
gchat:{space_base64url}:{thread_base64url}   # threaded reply
```

`encodeThreadId` / `decodeThreadId` are the only sanctioned way to
construct these — never `string.replace("/", …)` your way around the
encoding. `isDM` returns `true` when the underlying space type is
`DIRECT_MESSAGE`.

## Webhook flow

`GoogleChatAdapter.handleWebhook(request, options)` is the single
entry point. It dispatches based on the Chat event envelope:

1. **JWT validation** — Google signs every webhook with a service
   account. The adapter validates the `Authorization: Bearer …` token
   against Google's public certs using `google-auth-library`. Audience
   defaults to `https://chat.googleapis.com`; override via
   `webhookAudience`.
2. **Event type**
   - `MESSAGE` → `chat.handleIncomingMessage`. Mentions are detected
     by walking `message.annotations[].userMention` for the bot's own
     resource name.
   - `ADDED_TO_SPACE` → bot becomes available in a new space; chained
     to optional `onSpaceJoined` handlers.
   - `REMOVED_FROM_SPACE` → cleanup hook.
   - `CARD_CLICKED` → `chat.handleAction` + Card v2 button callback.
   - `DIALOG` (`request_type === "DIALOG"`) → modal lifecycle.
   - `WIDGET_UPDATED` → action loop for option-loading.
3. **Workspace Events** — `handleWorkspaceEvent` receives push
   notifications for spaces where the bot has a Workspace Events
   subscription (mentions, message updates, reactions). Subscriptions
   are managed externally; the adapter only consumes events.

## Authentication

Three credential modes:

- **Inline service account JSON** — pass `credentials: { client_email,
  private_key, … }` or set `GOOGLE_CHAT_CREDENTIALS` to the JSON or to
  a file path. The adapter detects each shape automatically.
- **Application Default Credentials** — set `GOOGLE_CHAT_USE_ADC=true`
  to use the ambient credentials (e.g. the Workload Identity attached
  to a Cloud Run service). No explicit credentials required.
- **Domain-wide delegation** — set `subject` (or
  `GOOGLE_CHAT_SUBJECT`) to a user email to act on that user's behalf.
  Requires the service account to be granted the
  `https://www.googleapis.com/auth/chat.bot` scope by a Workspace
  admin.

Auth tokens are cached with an automatic refresh ahead of expiry. The
adapter never logs raw tokens.

## Format conversion

`GoogleChatFormatConverter` (in `markdown.ts`) maps:

- mdast → Google Chat formatting — Google Chat uses a constrained
  subset of markdown: `*bold*`, `_italic_`, `~strike~`, single
  backticks for inline code, triple backticks for fenced code, and
  HTML-style links via `<url|label>`. The converter strips features
  Google Chat doesn't render (headings collapse to bold lines, lists
  emit as plain paragraphs with bullet prefixes).
- Google Chat formatting → mdast — round-trips bold, italic, strike,
  code, and links. User mentions arrive as separate annotation
  entries; the converter folds them into the AST as `link` nodes
  pointing at `users/{id}`.

`renderPostable` is the entry point for outbound rendering — it always
sets the message `text` field even when sending Card v2 payloads,
because the Chat search index uses the plain-text form.

## Cards & dialogs

`cardToCardV2` walks a Chat SDK `Card` JSX tree and emits the
[Card v2](https://developers.google.com/chat/ui/widgets) payload:

- `<Section>` / `<Header>` → `cardsV2.card.header` (only one), then
  `sections[].header` and `sections[].widgets[]`.
- `<Field>` → `decoratedText` widgets with `topLabel` and primary
  text.
- `<Image>` → `image` widget with optional `onClick.openLink`.
- `<Actions>` / `<Button>` → `buttonList.buttons[].onClick.action`,
  with `function` set to the callback id.
- `<LinkButton>` → `buttonList.buttons[].onClick.openLink`.
- `<Select>` → `selectionInput`. Multi-select / dropdown variants
  follow the Card v2 spec.
- `<Divider>` → `divider`.
- `<Table>` is rendered as a fixed-width formatted code block.

Dialog modals are emitted as `actionResponse.type: "DIALOG"` with the
form widget tree. Submit events arrive via `request_type: "DIALOG"`
on the inbound webhook.

## Workspace Events

`workspace-events.ts` consumes push notifications for Chat spaces the
bot is **not** a member of (e.g. mentions inside a space the user
keeps the bot out of). Two sub-flows:

1. **Subscription management** — outside the adapter; create a
   subscription via the Workspace Events API targeting your webhook
   URL.
2. **Event handling** — `handleWorkspaceEvent(request, options)`
   verifies the JWT, validates the `eventType`, and forwards into the
   same handler pipeline as direct events. The two flows share the
   same parsers in `index.ts`.

## Streaming

`postMessage` accepts `AsyncIterable<string | StreamChunk>` and
implements the post-then-edit pattern: the adapter posts a placeholder
message and edits it with the accumulated stream content. Min edit
interval defaults to 800 ms to stay under Google Chat's per-message
edit rate limit.

## Google Chat quirks worth remembering

- **JWT audience.** Misconfigured audiences are the most common cause
  of webhook 401s. The default is correct for Workspace Events; for
  bot apps published via the Marketplace, override `webhookAudience`.
- **Service account email is the bot identity.** Mentions of `@bot`
  resolve to the service account email, not a separate Chat user.
- **Threaded replies require the parent thread name**, not the parent
  message name — see `thread-utils.ts`.
- **`message.text` and Card v2** can both be present on a single
  outbound message; the Chat web UI shows the text above the card.
- **Reactions are limited to Unicode emoji.** Custom emoji uploaded
  via Workspace admin cannot be addressed via the public API.
- **Edit window.** A message can only be edited within ~30 days of
  posting; older edits return 403 `PERMISSION_DENIED`.
- **Space type is sticky.** Switching a space from "Threaded" to "Flat"
  requires recreating the space — handlers should not assume thread
  IDs persist after such a change.

## Testing approach

- **Unit tests** colocated with each module (`*.test.ts`). Use the
  `users/{id}` and `spaces/{id}/messages/{id}` fixtures from
  `sample-messages.md`.
- **Replay tests** in `packages/integration-tests/src/replay-gchat*.test.ts`
  feed recorded webhook traffic through the entire adapter.
- **Auth helpers** are mocked at the `google-auth-library` boundary;
  never make real auth calls in unit tests.

When you add a new event type, capture a fresh fixture in
`sample-messages.md` and add an assertion to the parser tests.

## Coding conventions

- All exports are `export function` / `export class` / `export const`
  — no default exports.
- Service-account JSON should never appear in test fixtures. Use the
  redacted templates in `index.test.ts`.
- Errors thrown to chat-sdk callers come from `@chat-adapter/shared`
  (`AuthenticationError`, `AdapterRateLimitError`, `NetworkError`,
  `ValidationError`).
- Top-level regex literals only (e.g.
  `SPACE_NAME_PATTERN`, `USER_RESOURCE_PATTERN`).
- Caching belongs in `user-info.ts` — don't sprinkle ad-hoc caches
  through the codebase.

## Releases

This package ships with the rest of the monorepo on the fixed
Changesets schedule. Behavioural changes need a changeset (`pnpm
changeset`, choose `@chat-adapter/gchat` plus `chat` if a public type
changed). README, sample-messages, and AGENTS.md edits are docs-only.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/gchat.mdx`](../../apps/docs/content/adapters/official/gchat.mdx)
- README: [`packages/adapter-gchat/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-gchat/sample-messages.md`](sample-messages.md)
