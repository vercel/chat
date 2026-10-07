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
  `initialize()` unless configured.

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
- A note with `type: null` is a top-level comment and maps to the merge
  request or issue thread. `DiscussionNote` and `DiffNote` map to the
  discussion thread, and `postMessage` replies inside that discussion.
- `encodeThreadId` / `decodeThreadId` are the only sanctioned constructors.
- The channel ID is `gitlab:{projectId}`.

## Webhook handling

- Only `object_attributes.action === "create"` comments dispatch. Edits,
  system notes, and commit or snippet comments are ignored.
- Internal notes, `Confidential Note Hook` events, and
  `event_type: "confidential_note"` are ignored on purpose. Replying would
  post their content into a public comment.
- Webhook notes are normalized into the REST `GitLabNote` shape
  (`object_attributes.note` becomes `body`, the top-level `user` becomes
  `author`) so parsing has one code path.
- Older payloads use `YYYY-MM-DD HH:MM:SS UTC` timestamps; `parseGitLabDate`
  handles both formats.

## REST API notes

- Edits and deletes use the notes API (`/notes/:note_id`) for every note,
  including discussion notes.
- Emoji reactions use `/notes/:note_id/award_emoji`. GitLab names match
  Slack-style shortcodes except the overrides in `GITLAB_EMOJI_NAMES`.
- List endpoints paginate with `x-next-page`; `requestAll` follows it up to
  `MAX_PAGES`.
- Errors map to `@chat-adapter/shared` errors: 401 `AuthenticationError`,
  403 `PermissionError`, 404 `ResourceNotFoundError`, 429
  `AdapterRateLimitError`, anything else `NetworkError`.
- Streaming is buffered: GitLab rejects empty note bodies, so the default
  post-then-edit fallback can't post a placeholder.

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
