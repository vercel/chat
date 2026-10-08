# AGENTS.md — `@chat-adapter/gitlab`

Guidance for coding agents working inside the GitLab adapter package.
The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules. Read it first.

## Overview

`@chat-adapter/gitlab` connects a Chat SDK bot to merge request and issue
comments on GitLab.com, GitLab Self-Managed, and GitLab Dedicated:

- Webhook endpoint at `/api/webhooks/gitlab` for `Note Hook` (comments) and
  `Emoji Hook` (reactions) events.
- Webhook verification with a signing token (Standard Webhooks
  `webhook-signature`, GitLab 19.0+), a secret token (`X-Gitlab-Token`), or a
  custom `webhookVerifier`.
- REST API v4 over `fetch` with one access token (`GITLAB_TOKEN`). There is no
  SDK dependency.
- Bot identity (`userName`, `botUserId`) detected from `GET /user` during
  `initialize()` unless configured. `ensureBotIdentity()` retries the lookup
  when a comment arrives and the ID is still unknown (at most every 30
  seconds). `isSelf()` compares user IDs, falling back to a configured
  username. With neither known, comments are dropped with a warning so the
  bot can't reply to itself.

## Directory layout

```
packages/adapter-gitlab/
├── src/
│   ├── index.ts             # GitLabAdapter + createGitLabAdapter
│   ├── index.test.ts
│   ├── cards.ts             # Card → GLFM markdown
│   ├── cards.test.ts
│   ├── markdown.ts          # GitLabFormatConverter (mdast ↔ GLFM)
│   ├── markdown.test.ts
│   ├── subclass.test-d.ts
│   └── types.ts             # config, thread ID, REST and webhook types
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

## Build, test, typecheck

```bash
pnpm --filter @chat-adapter/gitlab build
pnpm --filter @chat-adapter/gitlab test
pnpm --filter @chat-adapter/gitlab typecheck
```

## Thread ID format

```
gitlab:{projectId}:mr:{iid}
gitlab:{projectId}:issue:{iid}
gitlab:{projectId}:{mr|issue}:{iid}:{discussionId}
```

- `projectId` is the numeric project ID, which survives project renames and
  transfers. Never encode the project path: it contains `/`.
- Note Hook and Emoji Hook payloads carry each note's `discussion_id`,
  including top-level (`type: null`) comments, so every webhook note maps to
  its discussion thread and
  `postMessage` replies inside that discussion. Replying to a top-level
  comment turns it into a thread in GitLab's UI.
- Webhooks never produce the merge request or issue thread
  (`gitlab:{projectId}:{mr|issue}:{iid}`). `listThreads` returns it, posting
  to it creates a new top-level comment, and `fetchMessages` on it returns
  every non-system comment, paged by `x-next-page`.
- `encodeThreadId` / `decodeThreadId` are the only sanctioned constructors.
- The channel ID is `gitlab:{projectId}`.

## Webhook handling

- Notes with an `action` other than `create` (edits) are ignored, as are
  system notes and commit or snippet comments.
- Internal notes, `Confidential Note Hook` events, and
  `event_type: "confidential_note"` are ignored on purpose. Replying would
  post their content into a public comment.
- `isMention` is set by the adapter: `@userName` counts only outside inline
  code, code blocks, and block quotes.
- `metadata.edited` is always `false`. GitLab bumps `updated_at` on resolve
  and thread conversion, and the API has no last-edited field.
- The signing token is the `whsec_` value, with the prefix optional (32
  bytes: 43 base64 characters plus `=`). Malformed tokens throw at
  construction.
- Webhook notes are normalized into the REST `GitLabNote` shape
  (`object_attributes.note` becomes `body`, the top-level `user` becomes
  `author`) so parsing has one code path.
- Older payloads use `YYYY-MM-DD HH:MM:SS UTC` timestamps; `parseGitLabDate`
  handles both formats.

## REST API notes

- Edits and deletes use the notes API (`/notes/:note_id`) for every note,
  including discussion notes.
- Emoji reactions use `/notes/:note_id/award_emoji`. `GITLAB_EMOJI_NAMES`
  holds the normalized emoji whose Slack-style shortcode isn't GitLab's
  canonical award name; everything else uses the shortcode. Incoming award
  names are reverse-mapped through the same table.
- List endpoints paginate with `x-next-page`; `requestAll` follows it up to
  `MAX_PAGES`. `listThreads` and merge request or issue `fetchMessages` return
  the header as `nextCursor` instead, with `per_page` capped at 100.
- The `listThreads` root message is the merge request description (or title),
  not a note. Its ID is `mr-{iid}`. `notePath` rejects non-numeric IDs with
  `ValidationError`, and `fetchMessage` returns `null` for them.
- Errors map to `@chat-adapter/shared` errors: 400 and 422
  `ValidationError` with GitLab's reason, 401 `AuthenticationError`, 403
  `PermissionError`, 404 `ResourceNotFoundError`, 429
  `AdapterRateLimitError`, anything else `NetworkError`.
- Streaming is buffered and posted once: GitLab rejects empty note bodies, so
  the default post-then-edit fallback can't post a placeholder. An empty
  stream throws `ValidationError`.
- Strings, `{ raw }`, `{ markdown }`, and streamed text are posted as written
  apart from emoji placeholders, so GitLab references (`~label`, `!12`, `#12`)
  render. AST input is serialized with remark.

## Coding conventions

- Named exports only. Webhook and REST types live in `types.ts`.
- Top-level regex literals.
- Never log the access token or webhook tokens.

## Releases

Behavioral changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/gitlab`, plus `chat` if a public type changed).

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/gitlab.mdx`](../../apps/docs/content/adapters/official/gitlab.mdx)
- Core Adapter contract: [`packages/chat/src/types.ts`](../chat/src/types.ts)
- GitLab webhook events: <https://docs.gitlab.com/user/project/integrations/webhook_events/>
