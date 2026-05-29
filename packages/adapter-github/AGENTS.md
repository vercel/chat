# AGENTS.md — `@chat-adapter/github`

Guidance for coding agents working inside the GitHub adapter package.
The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/github` connects a Chat SDK bot to issue and
pull-request comment threads on GitHub. It covers:

- HTTP webhook endpoint at `/api/webhooks/github` for `issues`,
  `issue_comment`, `pull_request`, `pull_request_review_comment`,
  and `pull_request_review` events, validated with HMAC-SHA256
  against the App secret.
- Comment posting, editing, and deletion via the REST API (Issues,
  Pull Requests, and Reviews share comment endpoints).
- Reactions on comments + issues + pull requests.
- GitHub App authentication with installation-scoped tokens that
  auto-refresh.
- DM-style routing — there's no native GitHub DM, so DMs map to a
  user-mentions-only thread on a designated repo (configurable).

## Directory layout

```
packages/adapter-github/
├── src/
│   ├── index.ts             # GitHubAdapter + createGitHubAdapter
│   ├── index.test.ts
│   ├── cards.ts             # PostableMessage / Card → markdown comment body
│   ├── cards.test.ts
│   ├── markdown.ts          # GitHubFormatConverter (mdast ↔ GFM)
│   ├── markdown.test.ts
│   └── types.ts             # GitHub webhook event typings
├── sample-messages.md       # captured GitHub webhook deliveries
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

`sample-messages.md` holds full webhook deliveries for the supported
event types — extend it when adding handler coverage so the parser
tests stay grounded in real payloads.

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/github build
pnpm --filter @chat-adapter/github test
```

Replay tests live in
`packages/integration-tests/src/replay-github-*.test.ts`.

## Public surface

Main exports from `src/index.ts`:

- `createGitHubAdapter(config?)` — primary factory. Auto-detects
  `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` (PEM, may be base64-encoded),
  `GITHUB_WEBHOOK_SECRET`, and the optional `GITHUB_INSTALLATION_ID`
  for single-installation deployments.
- `GitHubAdapter` class — implements `Adapter<GitHubThreadId,
  unknown>`. Public methods: `handleWebhook`, `postMessage`,
  `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`,
  `fetchThread`, `listThreads`, `fetchMessages`, `fetchSingleMessage`,
  `fetchChannelInfo`, `postChannelMessage`, `openDM`,
  `getInstallation`, `setInstallation`.
- Configuration: `GitHubAdapterConfig`, `GitHubThreadId`,
  `GitHubInstallation`.
- Helpers: `cardToMarkdown`, `cardToFallbackText`,
  `GitHubFormatConverter`, `decodeThreadId`, `encodeThreadId`,
  `isDM`.

## Thread ID format

GitHub URLs use `{owner}/{repo}/issues/{number}` and
`{owner}/{repo}/pull/{number}`. The adapter encodes the same shape:

```
github:{owner}:{repo}:{type}:{number}
```

`type` is `issue`, `pr`, or `review` (review threads on a PR).
`encodeThreadId` / `decodeThreadId` are the only sanctioned
constructors.

`isDM(threadId)` returns `true` when the underlying issue is in the
configured DM repo (per `dmRepo` option).

## Webhook flow

`GitHubAdapter.handleWebhook(request, options)` is the entry point.

1. **Signature verification** — every delivery includes
   `X-Hub-Signature-256` (HMAC-SHA256 over the raw body). The adapter
   verifies it against `webhookSecret` with a timing-safe compare.
2. **Event routing**
   - `issues` (`opened`, `edited`, `closed`, `reopened`) → optional
     hooks; for `opened`, also dispatches `chat.handleIncomingMessage`
     when the issue body @mentions the bot.
   - `issue_comment` → `chat.handleIncomingMessage`. Mentions resolve
     by matching `@app-name` against the bot's app login.
   - `pull_request` (`opened`, `synchronize`, etc.) → optional hooks.
   - `pull_request_review_comment` → `chat.handleIncomingMessage`
     scoped to the review thread.
   - `pull_request_review` (`submitted`) → review-level events.
   - `reaction` → `chat.handleReaction` (added / removed).
   - `installation` / `installation_repositories` → installation
     lifecycle hooks; the adapter calls
     `setInstallation` / `deleteInstallation` automatically when
     `state` is configured.
3. **Token resolution** — every outbound API call goes through
   `withInstallationToken(installationId, …)`, which reads the
   installation token from cache or mints a fresh one via the App
   private key.

## Authentication (GitHub App)

Three pieces are required: the App ID, the App private key, and a
webhook secret. For multi-installation apps, the adapter:

- Reads the installation ID from the webhook payload
  (`installation.id`).
- Mints an installation access token via `POST
  /app/installations/{id}/access_tokens`, signing the JWT with the
  App private key (RS256).
- Caches the token in the configured state adapter under
  `{installationKeyPrefix}:{installationId}` until ~5 min before
  expiry.

For single-installation deployments, set `GITHUB_INSTALLATION_ID`
explicitly and skip the lookup. Out-of-webhook code uses
`withInstallationToken(installationId, async () => { … })`.

## Format conversion

`GitHubFormatConverter` (in `markdown.ts`) maps:

- mdast → GitHub Flavored Markdown — straightforward; GFM is a
  superset of mdast. Tables, fenced code with language hints,
  task lists, footnotes, and strikethrough all round-trip cleanly.
- GFM → mdast — same. The tricky bits are GFM tables, autolinks
  (`https://…` becomes a link automatically), and
  `@mentions` / `#issues` / `commit-sha` references which the
  converter preserves as text by default.
- Mentions of `@app-name[bot]` are detected via a leading-token check
  against the bot login.

`renderPostable` returns the body of an issue/PR/comment. Cards are
rendered as a markdown body — GitHub has no card primitive.

## Cards (markdown comments)

`cardToMarkdown` walks a Chat SDK `Card` JSX tree and emits a markdown
comment body:

- Header / Section → markdown headings + body paragraphs.
- Field → bullet list with `**label:** value` entries.
- Image → markdown image (`![alt](url)`); for binary uploads, the
  adapter posts to the user-content CDN first via the
  `attachments.upload` flow.
- LinkButton / Button → markdown links. GitHub doesn't support
  interactive buttons inside comments, so callbacks fall back to a
  link to a deep-link URL the bot can host.
- Divider → `---`.
- Table → GFM table.

`cardToFallbackText` is identical to `cardToMarkdown` for this adapter
because GitHub renders markdown directly.

## File uploads

GitHub comments can include image attachments that resolve to user-
content URLs. `postMessage` handles binary uploads transparently:

- Binary files get pre-uploaded to the user-content CDN via the
  authenticated `attachments.upload` endpoint.
- The returned URL is inlined into the markdown body as
  `![alt](https://user-images.githubusercontent.com/…)`.
- Larger-than-25 MB files are rejected with `ValidationError`.

## GitHub quirks worth remembering

- **Bot accounts append `[bot]`** to their login in mention syntax —
  always strip / re-add it consistently or mention detection breaks.
- **Reaction set is fixed** (`+1`, `-1`, `laugh`, `hooray`, `confused`,
  `heart`, `rocket`, `eyes`). Custom reactions throw 422.
- **Review comments vs issue comments** are different endpoints. The
  adapter chooses based on the `type` in the encoded thread id; never
  mix them.
- **Edit history.** GitHub keeps an edit log on every comment;
  rapid-fire edits can hit the abuse-detection limit (~30 per minute
  per author). Streaming aborts gracefully when this triggers.
- **Webhook redeliveries** — GitHub retries on non-2xx and may deliver
  the same event twice. Handlers must be idempotent.
- **`X-GitHub-Delivery`** is the dedupe key. Persist it for replay
  protection if the bot performs side effects.

## Testing approach

- **Unit tests** colocated with each module (`*.test.ts`). The card →
  markdown round-trip suite is the most comprehensive because GitHub
  is forgiving and easy to fool with malformed markdown.
- **Replay tests** in
  `packages/integration-tests/src/replay-github-*.test.ts` consume
  full webhook deliveries.
- **JWT signing** uses the same private key in tests and production;
  test fixtures use a throwaway PEM checked into
  `sample-messages.md`.

When you add support for a new event type, capture a fresh delivery
in `sample-messages.md`.

## Coding conventions

- Use named exports throughout. No default exports.
- Webhook event types live in `types.ts` — extend rather than
  importing from `@octokit/webhooks-types` to keep the bundle small.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `AdapterRateLimitError`, `NetworkError`, `ValidationError`).
- Top-level regex literals (`MENTION_REGEX`, `ISSUE_NUMBER_REGEX`,
  etc.).
- The App private key is sensitive — never log it, never round-trip
  it through structured logging or error messages.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/github` plus `chat` if a public type changed). Sample
fixtures and AGENTS.md edits don't.

## Resources

- [Ship a GitHub code review bot with Hono and Redis](https://vercel.com/kb/guide/ship-a-github-code-review-bot-with-hono-and-redis) — Walks through building a GitHub bot that reviews pull requests on demand. When a user @mentions the bot on a PR, Chat SDK picks up the mention, spins up a Vercel Sandbox with the repo cloned, and uses AI SDK to analyze the diff.

See all guides and templates at [chat-sdk.dev/resources](https://chat-sdk.dev/resources).

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/github.mdx`](../../apps/docs/content/adapters/official/github.mdx)
- README: [`packages/adapter-github/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook payloads: [`packages/adapter-github/sample-messages.md`](sample-messages.md)
