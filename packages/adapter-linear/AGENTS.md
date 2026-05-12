# AGENTS.md — `@chat-adapter/linear`

Guidance for coding agents working inside the Linear adapter package.
The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/linear` connects a Chat SDK bot to issue and project
comment threads inside Linear. It covers:

- HTTP webhook endpoint at `/api/webhooks/linear` for
  `Issue.create / update / remove`, `Comment.create / update / remove`,
  `IssueLabel`, and `Reaction` events, validated via the Linear
  webhook signing secret.
- Comment posting and editing via Linear's GraphQL API.
- OAuth-based authentication with installation tokens stored per
  workspace, plus a personal-API-key fallback for single-tenant bots.
- Reactions (Linear has its own emoji set + custom emoji per
  workspace).
- Issue thread routing — top-level comments belong to an issue's
  thread; threaded replies attach via `parentId`.

## Directory layout

```
packages/adapter-linear/
├── src/
│   ├── index.ts             # LinearAdapter + createLinearAdapter
│   ├── index.test.ts
│   ├── cards.ts             # PostableMessage / Card → Linear comment body
│   ├── cards.test.ts
│   ├── markdown.ts          # LinearFormatConverter (mdast ↔ Linear MD)
│   ├── markdown.test.ts
│   ├── utils.ts             # GraphQL helpers, identifier parsing
│   ├── utils.test.ts
│   └── types.ts             # Linear webhook + GraphQL typings
├── sample-messages.md       # captured Linear webhook deliveries
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
pnpm --filter @chat-adapter/linear build
pnpm --filter @chat-adapter/linear test
```

Replay tests live in
`packages/integration-tests/src/replay-linear-*.test.ts`.

## Public surface

Main exports from `src/index.ts`:

- `createLinearAdapter(config?)` — primary factory. Auto-detects
  `LINEAR_API_KEY` (personal token), `LINEAR_OAUTH_CLIENT_ID`,
  `LINEAR_OAUTH_CLIENT_SECRET`, and `LINEAR_WEBHOOK_SECRET`.
- `LinearAdapter` class — implements `Adapter<LinearThreadId,
  unknown>`. Public methods: `handleWebhook`, `postMessage`,
  `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`,
  `fetchThread`, `listThreads`, `fetchMessages`, `fetchSingleMessage`,
  `fetchChannelInfo`, `postChannelMessage`, `openDM`,
  `getInstallation`, `setInstallation`, `handleOAuthCallback`.
- Configuration: `LinearAdapterConfig`, `LinearThreadId`,
  `LinearInstallation`.
- Helpers: `cardToMarkdown`, `cardToFallbackText`,
  `LinearFormatConverter`, `decodeThreadId`, `encodeThreadId`,
  `isDM`.

## Thread ID format

Linear identifiers use the `team-key + counter` shape (`ENG-123`).
The adapter encodes the workspace and identifier:

```
linear:{workspaceSlug}:{issueId}                     # issue-level thread
linear:{workspaceSlug}:{issueId}:{parentCommentId}   # threaded reply
```

`encodeThreadId` / `decodeThreadId` are the canonical constructors
(see `utils.ts`). Linear has no native DM concept, so `isDM` always
returns `false`.

## Webhook flow

`LinearAdapter.handleWebhook(request, options)` is the entry point.

1. **Signature verification** — Linear signs the body with HMAC-SHA256
   and includes the timestamp in `Linear-Delivery`. The adapter
   verifies both with timing-safe comparison, rejecting payloads more
   than 5 minutes old.
2. **Event routing**
   - `Comment` (`create`, `update`, `remove`) →
     `chat.handleIncomingMessage` (or edit / delete hooks).
   - `Issue` (`create`, `update`, `remove`) → optional issue lifecycle
     hooks; `create` events with the bot @mentioned in the description
     also fire `chat.handleIncomingMessage`.
   - `IssueLabel` → optional label hooks.
   - `Reaction` (`create`, `remove`) → `chat.handleReaction`.
3. **Token resolution** — every outbound GraphQL call uses
   `withInstallationToken(workspaceId, …)` for OAuth-installed
   workspaces, or the personal API key when configured.

## Authentication

Two modes:

- **Personal API key** (`apiKey`) — single-workspace bots.
  Authenticates as the user who issued the key. Use the **app user**
  token for clean attribution; standard user tokens still work but
  attribute comments to the human.
- **OAuth** (`clientId` + `clientSecret`) — multi-workspace.
  `handleOAuthCallback` exchanges the auth code, persists the
  resulting access token in state under
  `{installationKeyPrefix}:{workspaceId}`, and refreshes ahead of
  expiry.

The personal API key path bypasses the state adapter for token
resolution; OAuth always reads/writes installations.

## Format conversion

`LinearFormatConverter` (in `markdown.ts`) maps:

- mdast → Linear Markdown — Linear renders a near-CommonMark subset
  with extensions: `[ ]` checkboxes (in lists), `:emoji:` shortcodes,
  inline code, fenced code with language hints, and `@mentions` via
  `@user-name`.
- Linear Markdown → mdast — round-trips the same constructs. Mentions
  become `link` nodes pointing at `@user-name`. The converter keeps
  emoji shortcodes intact rather than expanding to Unicode so the UI
  can render the workspace's custom emoji.
- Tables — Linear supports GFM tables; the converter passes them
  through unchanged.

## Cards (markdown comments)

`cardToMarkdown` walks a Chat SDK `Card` JSX tree:

- Header / Section → markdown headings and paragraphs.
- Field → bulleted `**label:** value` lines.
- Image → markdown image with the comment-attachment URL when binary
  data is provided (uploaded via the GraphQL `attachmentUpload`
  mutation first).
- Buttons / LinkButtons → markdown links to a deep-link URL. Linear
  doesn't render interactive buttons inside comments.
- Divider → `---`.
- Table → GFM table.

`cardToFallbackText` is identical to `cardToMarkdown` for this
adapter.

## Streaming

Linear comments cannot be edited indefinitely (the GraphQL mutation
returns 403 after the comment is more than 24h old in some
workspaces). The adapter follows the post-then-edit pattern with a
3-second min interval and stops editing once the stream completes or
the comment ages out.

## Reactions

`addReaction(threadId, messageId, emoji)` accepts:

- Unicode emoji (`👍`).
- Linear shortcodes (`thumbs_up`).
- Custom emoji names (`my_workspace_emoji`).

The adapter normalises these via `utils.ts` before sending the
GraphQL mutation. Removing a reaction requires the reaction id; the
adapter looks it up from the in-memory reaction cache populated by
inbound `Reaction.create` events.

## Linear quirks worth remembering

- **Three identity flavours.** Personal user tokens, OAuth user
  tokens, and OAuth app-user tokens. Comment attribution differs;
  always prefer the app-user token for bot-style attribution.
- **Webhook delivery latency.** Linear can deliver events out of
  order during high-traffic windows. Handlers must be idempotent.
- **Comment edit window.** Older comments cannot be edited; surface
  this gracefully when streaming aborts.
- **Workspace-scoped emoji.** Reactions accept unicode plus the
  workspace's custom emoji set. There is no global emoji namespace.
- **GraphQL pagination.** `fetchMessages` / `fetchChannelMessages`
  use cursor pagination via `pageInfo.endCursor` — keep cursors
  out of public types.
- **Issue identifiers vs IDs.** `ENG-123` is the human identifier
  shown in URLs, but the GraphQL API expects the UUID. `utils.ts`
  resolves identifiers to UUIDs via a single GraphQL query.

## Testing approach

- **Unit tests** colocated with each module (`*.test.ts`). The
  GraphQL request shape tests in `utils.test.ts` are the most
  comprehensive — extend them when adding new mutations or queries.
- **Replay tests** in
  `packages/integration-tests/src/replay-linear-*.test.ts` consume
  recorded webhook deliveries.
- **GraphQL transport** is mocked at the `fetch` boundary; never hit
  `api.linear.app` from unit tests.

When you add a new event type or mutation, capture a fresh fixture
in `sample-messages.md`.

## Coding conventions

- Use named exports throughout. No default exports.
- GraphQL helpers belong in `utils.ts` — keep `index.ts` focused on
  the adapter contract.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `AdapterRateLimitError`, `NetworkError`, `ValidationError`).
- Top-level regex literals (`IDENTIFIER_REGEX`, `MENTION_REGEX`,
  etc.).
- Always pass tokens through `withInstallationToken` instead of
  reading them ad-hoc from state.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/linear` plus `chat` if a public type changed). Sample
fixtures and AGENTS.md edits don't.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/linear.mdx`](../../apps/docs/content/adapters/official/linear.mdx)
- README: [`packages/adapter-linear/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-linear/sample-messages.md`](sample-messages.md)
