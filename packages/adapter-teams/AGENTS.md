# AGENTS.md — `@chat-adapter/teams`

Guidance for coding agents working inside the Microsoft Teams adapter
package. The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/teams` connects a Chat SDK bot to a Microsoft Teams
tenant via the Bot Framework + Microsoft Graph. It covers:

- HTTP webhook endpoint at `/api/webhooks/teams` (Bot Framework
  Activity payload, JWT-signed by Microsoft).
- Adaptive Card rendering for cards, modals (Task Modules), and
  inline-action buttons.
- Microsoft Graph fallbacks for fetch/list endpoints the Bot Framework
  doesn't expose.
- Single-tenant and multi-tenant app support, plus channel + DM
  conversations and threaded replies.
- Streaming with the Bot Framework Activity update flow (post a
  placeholder, edit as deltas arrive).

The adapter wraps both transports — Bot Framework for inbound
events/outbound posts and Graph API for richer reads — through a
single `TeamsAdapter` instance.

## Directory layout

```
packages/adapter-teams/
├── src/
│   ├── index.ts             # TeamsAdapter + createTeamsAdapter factory
│   ├── index.test.ts
│   ├── bridge-adapter.ts    # adapter-side glue between Bot Framework + Chat SDK
│   ├── api/                 # low-level Bot Connector REST primitives
│   ├── cards.ts             # Card / PostableMessage → Adaptive Cards
│   ├── cards-primitives/    # plain-object Adaptive Card primitives
│   ├── cards.test.ts
│   ├── config.ts            # configuration parsing & env resolution
│   ├── errors.ts            # AuthenticationError / RateLimit mapping
│   ├── errors.test.ts
│   ├── format/              # runtime-free Teams string helpers
│   ├── graph/               # low-level Microsoft Graph REST primitives
│   ├── graph-api.ts         # Microsoft Graph client wrapper
│   ├── graph-api.test.ts
│   ├── markdown.ts          # TeamsFormatConverter (mdast ↔ Teams HTML)
│   ├── markdown.test.ts
│   ├── modals.ts            # Modal → Task Module conversion
│   ├── modals-primitives/   # plain-object Task Module primitives
│   ├── modals.test.ts
│   ├── thread-id.ts         # encode/decode/isDM helpers
│   ├── types.ts             # internal Teams payload typings
│   └── webhook/             # parse-only Activity webhook primitives
├── sample-messages.md       # captured Bot Framework activities
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

`bridge-adapter.ts` adapts the `@microsoft/teams.apps` route handler
into the Chat SDK adapter contract. Keep it free of business logic —
convert and forward only.

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/teams build
pnpm --filter @chat-adapter/teams test
```

Replay tests for Teams live in
`packages/integration-tests/src/replay-teams-*.test.ts` — extend the
fixture corpus instead of mocking new payloads when adding behavior.

## Public surface

The package's main exports (see `src/index.ts`):

- `createTeamsAdapter(config?)` — primary factory. Auto-detects
  `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID`,
  `TEAMS_APP_TYPE` (single/multi tenant), and the optional
  `TEAMS_GRAPH_TENANT` overrides.
- `TeamsAdapter` class — implements `Adapter<TeamsThreadId, unknown>`.
  Public methods: `handleWebhook`, `postMessage`, `editMessage`,
  `deleteMessage`, `addReaction`, `removeReaction`, `startTyping`,
  `openModal`, `pushModal`, `getInstallation`, `setInstallation`,
  `deleteInstallation`, `fetchThread`, `listThreads`, `fetchMessages`,
  `fetchSingleMessage`, `fetchChannelInfo`, `postChannelMessage`,
  `openDM`.
- Configuration types: `TeamsAdapterConfig`, `TeamsThreadId`,
  `TeamsInstallation`, `TeamsAppType`.
- Helpers re-exported from sub-modules:
  `cardToAdaptiveCard`, `cardToFallbackText`, `TeamsFormatConverter`,
  `decodeThreadId`, `encodeThreadId`, `isDM`.

Low-level subpaths are exported for custom runtimes that do not want the
full Chat SDK adapter graph:

- `@chat-adapter/teams/api` — fetch-based Bot Connector message,
  typing, and conversation helpers.
- `@chat-adapter/teams/graph` — fetch-based Microsoft Graph reads with
  explicit `teamId`, `channelId`, or `chatId`.
- `@chat-adapter/teams/webhook` — parse-only Activity classification
  and continuation extraction. It does **not** verify Bot Framework
  JWTs.
- `@chat-adapter/teams/format` — runtime-free Teams HTML, mention, and
  emoji helpers.
- `@chat-adapter/teams/cards` — plain-object Adaptive Card helpers.
- `@chat-adapter/teams/modals` — plain-object Task Module helpers.

Primitive subpaths must not import `chat`, `@chat-adapter/shared`,
`@microsoft/teams.apps`, or the main adapter entry. Keep boundary tests
updated whenever a new primitive file is added.

## Thread ID format

Teams conversation IDs contain colons (e.g.
`19:abc@thread.tacv2;messageid=…`), so the adapter base64url-encodes
them before assembling the Chat SDK identifier:

```
teams:{conversationId_base64url}
teams:{conversationId_base64url}:{rootMessageId}    # threaded reply
```

`encodeThreadId` / `decodeThreadId` are the only sanctioned way to
construct these — never `string.replace(":", …)` your way around the
encoding.

`isDM(threadId)` returns `true` when the underlying conversation type
is `personal` (1:1 with the bot) — useful inside handlers that need to
branch on private vs channel context.

## Webhook flow

`TeamsAdapter.handleWebhook(request, options)` is the entry point.
It performs:

1. **JWT validation** — Bot Framework signs every activity with a
   tenant-aware JWT. Validation uses the
   `microsoftAppCredentialsFactory` configured with `appId`,
   `appPassword`, and `tenantId`.
2. **Activity routing**
   - `message` → `chat.handleIncomingMessage` (or `onNewMention` /
     `onSubscribedMessage` depending on @mention detection).
   - `messageReaction` → `chat.handleReaction`.
   - `messageUpdate` / `messageDelete` → optional update/delete hooks.
   - `invoke` (`task/fetch`, `task/submit`, `adaptiveCard/action`) →
     modal lifecycle and action callbacks.
3. **Outbound `Activity`** — `postMessage` constructs an Activity with
   the Adaptive Card payload + fallback text, then sends it through
   the connector client. Sub-second roundtrips matter; long-running
   work goes through `waitUntil`.

## Authentication

Teams uses Bot Framework + Microsoft Entra ID. Three modes:

- **Single-tenant** (`appType: "SingleTenant"`) — one app registration
  in your tenant. Simple, but cannot install into other tenants.
- **Multi-tenant** (`appType: "MultiTenant"`) — public app, OAuth
  consent in each tenant. Requires `tenantId` per webhook (looked up
  from the activity's `serviceUrl`).
- **Managed Identity** — set `appType: "ManagedIdentity"` and rely on
  the Azure-side identity assigned to the host. No `appPassword`
  needed.

Channel-and-DM tokens are issued by Microsoft on the inbound JWT and
re-used for outgoing requests. Multi-tenant deployments still need to
persist the install metadata in the configured state adapter so the
bot can later post out-of-band — `getInstallation` / `setInstallation`
accept any storage shape that survives `JSON.stringify`.

## Microsoft Graph

`graph-api.ts` wraps the Graph client with:

- Lazy initialization — instantiated on first call so unit tests don't
  pull network credentials.
- Retry-aware request helper that maps `401` to `AuthenticationError`,
  `403` to `PermissionError`, `429` to `AdapterRateLimitError` (with
  the `Retry-After` header surfaced via `retryAfterMs`), and `5xx` to
  `NetworkError`.
- Graph-only methods: `fetchChannelInfo`, `fetchTeamInfo`,
  `listChannelMessages`, `fetchSingleMessage`, `addReaction`,
  `removeReaction`. The Bot Framework alone cannot serve these.

## Format conversion

`TeamsFormatConverter` (in `markdown.ts`) maps:

- mdast → Teams HTML — Teams renders message text as HTML, not
  markdown. Headings → `<h*>`, lists → `<ul>` / `<ol>`, blockquotes,
  inline code, fenced code → `<pre><code>`, tables → `<table>`. Bold
  / italic / strike / link work via `<strong>`, `<em>`,
  `<s>`, `<a href>`.
- Teams HTML → mdast — DOMParser-light walk that recognises the same
  tags. Robust against the noisy markup Teams sometimes injects (extra
  `<div>` wrappers, `dir="ltr"` attributes, OneNote-style namespaced
  spans).
- Mentions — `<at>name</at>` tags are paired with `entities` on the
  Activity, so `toAst` and `fromAst` keep entities and inline text in
  sync.

`renderPostable` converts a `PostableMessage` into the HTML body shape
Teams expects. Use it through `cards.ts`; bypassing it is a code
smell.

## Cards & modals

`cardToAdaptiveCard` walks a Chat SDK `Card` JSX tree and emits
Adaptive Card v1.5 JSON. Notable mappings:

- `<Section>` → `Container`; `<Header>` → `TextBlock` with
  `size: large weight: bolder`.
- `<Field>` → `FactSet`.
- `<Image>` → `Image` (data URLs and http(s) URLs both supported).
- `<Actions>` / `<Button>` → `Action.Submit` (with `data` carrying the
  callback metadata).
- `<LinkButton>` → `Action.OpenUrl`.
- `<Select>` → `Input.ChoiceSet` (single, multi, or compact based on
  options).
- `<Divider>` → `Container` with a top border.
- `<Table>` → `Table` (Adaptive Card 1.5+).

`modals.ts` handles Task Modules: `Modal.title` / `submitLabel` map to
`title` / `value` of the surrounding `task/fetch` response. Submit
events arrive as `invoke` activities and are dispatched through
`chat.handleAction`.

## Streaming

`postMessage` accepts `AsyncIterable<string | StreamChunk>` and
implements the Bot Framework streaming pattern: post a placeholder
Adaptive Card, then update it as deltas arrive. The minimum interval
between edits avoids hitting the per-conversation rate limit (default
~1 RPS in Teams).

## Teams quirks worth remembering

- **JWT clock skew.** Microsoft tokens have a hard 5-minute window —
  containers running with skewed clocks fail validation. Surface clock
  drift as a deployment-level alert.
- **Conversation IDs leak channel ↔ DM context.** Use `isDM` rather
  than parsing the encoded blob.
- **Adaptive Card 1.6 is not universally available.** Stay on 1.5
  primitives unless the rendering host is known to support newer
  features.
- **Threaded replies require a root `messageId`.** When you reply,
  encode the root into the thread id (see `thread-id.ts`).
- **Graph fetches need delegated permissions** for cross-team reads.
  `fetchChannelMessages` will return 403 in some tenants until a
  Graph-API admin consent is granted.
- **`messageReaction` events are coalesced** — the Activity describes
  the *delta* (added vs removed) rather than the current state. Keep
  reaction handlers idempotent.

## Testing approach

- **Unit tests** colocated with each module (`*.test.ts`). Use the
  fixtures in `sample-messages.md` rather than fabricating Bot
  Framework payloads.
- **Replay tests** at `packages/integration-tests/src/replay-teams*.test.ts`
  feed recorded webhook traffic through the full adapter.
- **Graph API tests** stub the HTTP transport with `vi.fn()` (see
  `graph-api.test.ts`) — never call the real Graph API in unit tests.

When you add support for a new Activity type, capture a fresh fixture
in `sample-messages.md` so the parser tests stay grounded.

## Coding conventions

- Use the named-export style throughout. No default exports.
- Keep `index.ts` slim — push helper logic into `cards.ts`,
  `markdown.ts`, `modals.ts`, `graph-api.ts`, etc.
- Wrap Microsoft Graph errors in the typed errors from `errors.ts`;
  never let raw `RestError` instances escape.
- Avoid `process.env` outside the factory. Pass config explicitly.
- Top-level regex literals; reuse the helpers in `thread-id.ts`
  instead of writing your own colon-splitter.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/teams` plus `chat` if a public type changed). Internal
refactors and AGENTS.md edits don't.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/teams.mdx`](../../apps/docs/content/adapters/official/teams.mdx)
- README: [`packages/adapter-teams/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-teams/sample-messages.md`](sample-messages.md)
