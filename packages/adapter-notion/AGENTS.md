# AGENTS.md — `@chat-adapter/notion`

Guidance for coding agents working inside the Notion adapter package.
The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first.

## Overview

`@chat-adapter/notion` connects a Chat SDK bot to Notion **comments**
(page-level and discussion threads) via:

- Webhooks (`comment.created`) with `X-Notion-Signature` HMAC verification
  and a one-time `verification_token` handshake
- Comments REST API (create / update / delete / list / retrieve)
- Outbound files via File Uploads API (`single_part` binary + `external_url`
  for public URLs). `external_url` imports are polled until `uploaded` before
  attach (default `[0, 5000, 10000]` — immediate recheck then 5s/10s; override
  with `externalUrlPollDelaysMs`). Never attach while `pending`. Up to 3
  native comment attachments; overflow/failures/timeouts become markdown
  links. Edits link files in markdown only (PATCH may not attach).
- Post+Edit streaming with a global ~3 req/s token bucket

## Directory layout

```
packages/adapter-notion/
├── src/
│   ├── index.ts             # NotionAdapter + createNotionAdapter
│   ├── index.test.ts
│   ├── types.ts
│   ├── utils.ts             # thread IDs, HMAC, deep links
│   ├── markdown.ts          # NotionFormatConverter
│   ├── cards.ts             # card → markdown fallback
│   ├── rate-limit.ts        # token bucket
│   └── testing.ts           # @chat-adapter/notion/testing
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

## Public surface

- `createNotionAdapter(config?)` / `NotionAdapter` / `NotionAdapterConfig`
- Env: `NOTION_TOKEN`, `NOTION_VERIFICATION_TOKEN`, optional
  `NOTION_BOT_USERNAME`, `NOTION_VERSION`, `NOTION_MENTION_MODE`,
  `NOTION_KEYWORDS`
- Pinned API version: `DEFAULT_NOTION_VERSION` (`2026-03-11`)
- Testing: `@chat-adapter/notion/testing`
- `fetchSubject` → `message.subject` resolves the parent page via
  `GET /v1/pages/{pageId}` (page object / properties on `raw`, not block children)

## Thread IDs

```
notion:{pageId}
notion:{pageId}:{discussionId}
notion:{pageId}:block:{blockId}
```

UUIDs are normalized to lowercase hyphenated form. Outbound whole-block
discussion starts use `notion:{pageId}:block:{blockId}` (`NotionThreadId.blockId`).
When both `discussionId` and `blockId` are present, encode prefers discussionId.
Selected-text discussions cannot be started via API.

## Non-goals (v0.1)

Reactions, modals, DMs, typing indicators, multi-workspace OAuth,
page-content event triggers, selected-text discussion creation.

## Mentions

`mentionMode`: `"mention"` | `"all-comments"` | `"keyword"`.
Default `"mention"` matches plain-text `@userName` / `@botUserId`
(Notion connection bots are not @-mentionable in the composer).
`NOTION_KEYWORDS` is comma-separated when mode is `"keyword"`.

## Where to look next

- Docs: [`apps/docs/content/adapters/official/notion.mdx`](../../apps/docs/content/adapters/official/notion.mdx)
- PRD: [`notion-adapter-prd.md`](../../notion-adapter-prd.md)
