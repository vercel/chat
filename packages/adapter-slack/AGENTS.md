# AGENTS.md — `@chat-adapter/slack`

Guidance for coding agents working inside the Slack adapter package. The
top-level repository [AGENTS.md](../../AGENTS.md) covers monorepo-wide
build, lint, and release rules — read it first. This file documents the
adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/slack` connects a Chat SDK bot to a Slack workspace. It
covers:

- HTTP webhook endpoint at `/api/webhooks/slack` (events, slash commands,
  interactivity, view submissions, block_suggestion options loads, OAuth
  callback dispatch).
- Optional Socket Mode transport with a forwarding mechanism for
  serverless platforms (Vercel cron → transient WebSocket → forwarded
  HTTP).
- Single-workspace bot tokens or multi-workspace OAuth (with token
  encryption-at-rest and an external installation provider hook).
- Block Kit rendering for cards, modals, ephemeral messages, slash
  commands, scheduled messages, file uploads, and the Slack Assistants
  API.
- Native streaming via `chat.update` deltas plus a Block Kit fallback
  for non-streaming Slack flavours (e.g. GovSlack).

The adapter is the first Chat SDK target and the most fully-featured —
several conventions in `packages/chat` were originally shaped here.

## Directory layout

```
packages/adapter-slack/
├── src/
│   ├── index.ts             # SlackAdapter class + createSlackAdapter factory
│   ├── index.test.ts        # unit tests for adapter behaviour
│   ├── cards.ts             # PostableMessage / Card → Block Kit
│   ├── cards.test.ts
│   ├── crypto.ts            # AES-256-GCM bot token encryption helpers
│   ├── crypto.test.ts
│   ├── markdown.ts          # SlackFormatConverter (mdast ↔ mrkdwn)
│   ├── markdown.test.ts
│   ├── modals.ts            # Modal element conversion + view metadata
│   └── modals.test.ts
├── sample-messages.md       # real webhook payloads used as fixtures
├── package.json
├── tsconfig.json
├── tsup.config.ts           # ESM bundle config
├── vitest.config.ts
└── README.md                # user-facing quick start
```

`sample-messages.md` is a curated set of real webhook payloads — extend
it whenever you fix a parser bug or add support for a new event so the
fixture corpus stays representative.

## Build, test, typecheck

```bash
# from the package directory
pnpm build           # tsup ESM bundle → dist/
pnpm dev             # tsup --watch
pnpm test            # vitest run --coverage
pnpm test:watch      # vitest interactive
pnpm typecheck       # tsc --noEmit
pnpm clean           # rm -rf dist

# from the repo root
pnpm --filter @chat-adapter/slack build
pnpm --filter @chat-adapter/slack test
```

Tests in this package are pure unit tests (Vitest). Integration tests
that hit the real Slack API live in
`packages/integration-tests/src/slack.test.ts` and replay tests live in
`packages/integration-tests/src/replay-*.test.ts` — both run against
recorded fixtures, so they don't need workspace credentials.

## Public surface

The package's main exports (see `src/index.ts`):

- `createSlackAdapter(config?)` — primary factory. Auto-detects
  `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`,
  `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_ENCRYPTION_KEY`. When
  any auth-related field is passed explicitly, env-fallback for the
  remaining auth fields is **disabled** to prevent accidental mode
  mixing.
- `SlackAdapter` class — implements the Chat SDK `Adapter<SlackThreadId,
  unknown>` interface. Public methods include `handleWebhook`,
  `postMessage`, `editMessage`, `deleteMessage`, `addReaction`,
  `removeReaction`, `startTyping`, `openModal`, `getInstallation`,
  `setInstallation`, `deleteInstallation`, `handleOAuthCallback`,
  `withBotToken`, `setSuggestedPrompts`, `setAssistantStatus`,
  `setAssistantTitle`, `publishHomeView`, `startSocketModeListener`.
- `SlackAdapterConfig`, `SlackBotToken`, `SlackInstallation`,
  `SlackThreadId`, `SlackEvent`, `SlackReactionEvent`,
  `SlackAdapterMode`, `SlackOAuthCallbackOptions` — configuration and
  event types.
- `cardToBlockKit`, `cardToFallbackText` — exposed for advanced users
  who need to render Block Kit outside the adapter.
- `decodeKey`, `EncryptedTokenData` — encryption helpers for callers
  that manage installations themselves.

## Thread ID format

```
slack:{channelId}:{threadTs}
```

`channelId` is the Slack channel (`C…` / `G…` / `D…`), `threadTs` is the
parent message timestamp with the dot intact (e.g.
`1234567890.123456`). The adapter exposes `encodeThreadId` /
`decodeThreadId` so other code can build IDs without string
concatenation.

For Slack Assistants API events, the parent message timestamp **is** the
assistant thread root — same encoding applies.

## Webhook flow

`SlackAdapter.handleWebhook(request, options)` is the single entry point
the chat instance routes Slack traffic through. It dispatches based on
the Slack event envelope:

1. **Verification** — verify the `X-Slack-Signature` HMAC against the
   raw body using `signingSecret`, or call the user-supplied
   `webhookVerifier` if configured. Both checks use a constant-time
   string comparison via `node:crypto.timingSafeEqual`.
2. **Body type** — JSON for events / view submissions / OAuth, URL-form
   for slash commands and interactive payloads.
3. **Routing**
   - `event_callback` → `handleSlackEvent` → `chat.handleIncomingMessage`
     (or one of the assistant-thread / reaction / channel-join handlers).
   - `view_submission`, `view_closed` → modal lifecycle.
   - `block_actions` → `chat.handleAction`.
   - `block_suggestion` → `chat.handleOptionsLoad` (3 s SLA, hard timeout
     at 2.5 s — see `OPTIONS_LOAD_TIMEOUT_MS`).
   - `slash_command` → `chat.handleSlashCommand`.
4. **`waitUntil`** — long-running side effects (unfurl polling, AI
   streaming, modal pushes after the response) are scheduled via the
   `waitUntil` provided by the host (`next/server` `after`,
   `@vercel/functions` `waitUntil`, or a custom shim).

## Authentication modes

### Single-workspace

Bot token (`xoxb-…`) + signing secret. The adapter uses the bot token
directly for every API call and does not touch the state adapter.

### Multi-workspace OAuth

Provide `clientId` + `clientSecret` and an OAuth redirect URL that
calls `adapter.handleOAuthCallback(request, { redirectUri })`. The
adapter:

- Exchanges the auth code via `oauth.v2.access`.
- Persists the resulting `SlackInstallation` (bot token, scopes, team
  metadata, optional enterprise metadata) in the configured state
  adapter under `{installationKeyPrefix}:{teamId}` (or
  `:{enterpriseId}` for org-wide installs).
- Encrypts the bot token with AES-256-GCM if `encryptionKey` is set.

### Token rotation

`botToken` accepts either a `string` or `() => string | Promise<string>`.
The function is invoked per API call, so it composes naturally with
Slack token rotation (12-hour TTL) or lazy fetches from a secret
manager. Cache inside the resolver if the lookup is expensive.

### `withBotToken`

`AsyncLocalStorage` is used to scope a bot token for a callback so
out-of-webhook code (cron jobs, queues) can post to a specific
workspace without mutating adapter state. Always wrap such code in
`adapter.withBotToken(install.botToken, async () => { … })`.

### External installation provider

`installationProvider.getInstallation` is read-only and bypasses the
state adapter for token resolution. `setInstallation`,
`deleteInstallation`, and `handleOAuthCallback` continue to write to
the internal state adapter, so external providers must export those
writes themselves if they need to round-trip them.

## Format conversion

`SlackFormatConverter` (in `markdown.ts`) implements:

- `toAst(text)` — Slack mrkdwn → mdast. Handles `<@U…>`, `<#C…>`,
  `<!subteam^…>`, link/email syntax (`<url|label>`), bold (`*…*`),
  italic (`_…_`), strike (`~…~`), inline code, code fences, and
  blockquotes. Mentions resolve via the `users.info` /
  `usergroups.list` calls keyed by user-info cache to avoid round-trips.
- `fromAst(ast)` — mdast → mrkdwn. Lists, blockquotes, inline emphasis,
  links and code blocks all round-trip. Tables are flattened to fenced
  text because Slack mrkdwn has no table primitive.
- `renderPostable(message)` — `PostableMessage` → mrkdwn. Used for
  fallback text on Block Kit messages and for ephemeral messages.

When updating these converters, mirror changes in `cards.ts` so the
fallback text on Block Kit blocks stays accurate.

## Cards & rich content

`cardToBlockKit` (in `cards.ts`) translates the Chat SDK `Card` JSX
shape into Slack Block Kit:

- `<Section>` → `section` blocks; `<Header>` → `header` blocks.
- `<Field>` → side-by-side `mrkdwn` fields.
- `<Image>` → `image` blocks (max 5 MB or via `image_url`).
- `<Actions>` and `<Button>` → `actions` blocks with `button` elements.
- `<LinkButton>` becomes a `button` with `url` set (no callback).
- `<Select>` → `static_select`, `multi_static_select`, or
  `external_select` (when `loadOptions` is supplied).
- `<Divider>` → `divider`.
- `<Table>` is rendered as a fixed-width `mrkdwn` block — Slack has no
  native table primitive.

`cardToFallbackText` produces a plain-text rendering used as the message
`text` so notifications, search, and screen readers still get usable
content.

## Modals

`openModal`, `pushModal`, and `updateModal` accept either Chat SDK modal
JSX or pre-built Slack views. `modals.ts` handles the translation:

- `Modal.callbackId` → `view.callback_id`.
- `Modal.title` / `Modal.submitLabel` / `Modal.closeLabel` → matching
  view fields.
- `TextInput`, `Select`, `RadioSelect`, `Checkbox`, `DatePicker`,
  `TimePicker`, `UserSelect`, `ChannelSelect`, `ConversationSelect` are
  all mapped to the corresponding Block Kit element.
- Per-modal metadata (callback URL, custom params, AI plan id) is
  base64url-JSON-encoded into `view.private_metadata` and decoded on
  submission.

## Streaming

`postMessage` accepts `AsyncIterable<string | StreamChunk>` and pumps
the deltas onto Slack via incremental `chat.update` calls, with a
configurable minimum-edit interval to avoid hitting Slack's rate
limit. The streaming markdown renderer keeps mrkdwn formatting valid as
the stream progresses (no half-formed tags).

For Assistants API threads, the adapter additionally drives
`assistant.threads.setStatus` between deltas so the user sees a
"thinking…" indicator.

## Socket Mode

Socket Mode is opt-in via `mode: "socket"` and `appToken` (`xapp-…`).
On serverless, use `startSocketModeListener` from a cron route — the
listener accepts events for `durationMs`, then forwards each as an
HTTP request to your existing webhook URL (so all webhook handlers
keep working unchanged). Forwarded requests are signed with
`socketForwardingSecret` (defaults to `SLACK_SOCKET_FORWARDING_SECRET`,
falling back to `appToken`).

## Slack quirks worth remembering

- **3-second response SLAs.** Events, slash commands, view
  submissions, and block_suggestion all enforce them. Schedule any
  follow-up work via `waitUntil`.
- **`text` is required** alongside Block Kit blocks. The adapter sets
  it to `cardToFallbackText` automatically; if you bypass the adapter,
  set it yourself.
- **DM channels (`D…`) reuse the user ID for `user.id`** — never trust
  channel IDs as the only identity hint.
- **Slack truncates blocks** silently at 50 per message; the adapter
  splits oversize Block Kit payloads into multiple messages and links
  them with a "View more" actions row.
- **Reaction events** include both `reaction_added` and `reaction_removed`
  — keep `addReaction` / `removeReaction` symmetric.
- **Token encryption-at-rest** is opt-in. `encryptionKey` must be a
  base64-encoded 32-byte key; rotate it by reading old installations,
  re-encrypting, and writing back.

## Testing approach

- **Unit tests (`*.test.ts`)** — colocated with each module. Test the
  parsers, format converter, card builder, and crypto helpers in
  isolation using `createMockState` from `packages/chat/src/mock-adapter.ts`.
- **Replay tests** — `packages/integration-tests/src/replay-*.test.ts`
  feed recorded fixtures through the full webhook flow. Re-record by
  running the bot locally against a real workspace and exporting via
  `pnpm recording:export <session-id>` from `examples/nextjs-chat`.
- **Adapter contract tests** — exercise `Adapter` interface conformance
  via the shared test kit at `packages/tests`.

When adding a feature, prefer extending an existing fixture in
`sample-messages.md` rather than fabricating a payload from scratch.

## Coding conventions

- All exports are `export function`, `export const`, or `export class`
  — no default exports.
- Public types live alongside the implementation in `src/index.ts` and
  are re-exported from the package entry. Internal-only types stay in
  their dedicated module (`crypto.ts`, `modals.ts`).
- The adapter never calls `process.env` outside the
  `createSlackAdapter` factory; runtime code receives explicit config.
- Webhook handlers must return `Response` synchronously; long work
  goes through `waitUntil`.
- Errors thrown to chat-sdk callers come from `@chat-adapter/shared`
  (`AuthenticationError`, `AdapterRateLimitError`, `NetworkError`,
  `ValidationError`) — don't invent new error classes.
- Top-level regex literals only. Several exist in `index.ts`
  (`SLACK_USER_ID_PATTERN`, `TRAILING_SLASH_PATTERN`, etc.); follow the
  same pattern.

## Releases

This package ships with the rest of the monorepo on a fixed Changesets
schedule. Behavioural changes need a changeset (`pnpm changeset`,
choose `@chat-adapter/slack` plus `chat` if a public type changed).
README updates, sample-message additions, and AGENTS.md edits are
docs-only — no changeset required.

## Resources

- [How to build an AI agent for Slack with Chat SDK and AI SDK](https://vercel.com/kb/guide/how-to-build-an-ai-agent-for-slack-with-chat-sdk-and-ai-sdk) — Build a Slack AI agent using Chat SDK, AI SDK's ToolLoopAgent, and Vercel AI Gateway. Covers project setup, tool definitions, streaming responses, deployment to Vercel, and scaling tool selection with toolpick.
- [How to build a Slack bot that manages files in Vercel Blob](https://vercel.com/kb/guide/slack-bot-vercel-blob) — Build a Slack bot that lists, reads, uploads, and deletes files in Vercel Blob through tool calls. Uses Chat SDK, AI SDK's ToolLoopAgent, and Files SDK's `createFileTools` factory with approval-gated write tools and a read-only mode.
- [How to build a Slack bot with Next.js and Redis](https://vercel.com/kb/guide/how-to-build-a-slack-bot-with-next-js-and-redis) — Walks through building a Slack bot with Next.js, covering project setup, Slack app configuration, event handling, interactive features, and deployment.

See all guides and templates at [chat-sdk.dev/resources](https://chat-sdk.dev/resources).

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/slack.mdx`](../../apps/docs/content/adapters/official/slack.mdx)
- README: [`packages/adapter-slack/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-slack/sample-messages.md`](sample-messages.md)
