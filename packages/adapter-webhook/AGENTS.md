# AGENTS.md: `@chat-adapter/webhook`

Guidance for coding agents working inside the webhook adapter package. The top-level repository [AGENTS.md](../../AGENTS.md) covers monorepo-wide build, lint, and release rules.

## Overview

`@chat-adapter/webhook` is a platform-agnostic adapter. It owns the parts every HTTP platform shares and delegates the platform-specific parts to user callbacks:

- Adapter: request verification (HMAC-SHA256 via `secret`/`WEBHOOK_SECRET`, or a `verify` callback), JSON decoding, thread ID encoding, Markdown conversion, and routing to `chat.processMessage`.
- User callbacks: `parse` (payload to `WebhookInboundMessage[]`) and `send` (required), plus optional `edit`, `delete`, and `startTyping`.

## Directory layout

```
packages/adapter-webhook/
├── src/
│   ├── index.ts           # WebhookAdapter + createWebhookAdapter
│   ├── index.test.ts
│   ├── markdown.ts        # WebhookFormatConverter (Markdown in and out)
│   ├── types.ts           # Config and callback types
│   └── types.test-d.ts    # Config inference and subclass access checks
└── README.md
```

## Conventions

- The adapter `name` is the thread ID prefix and must match the key in `Chat`'s `adapters`, because Chat SDK routes by prefix. Names cannot contain `:`.
- Thread ID segments are base64url-encoded so any platform ID round-trips.
- `persistThreadHistory` is `true`; `fetchMessages` returns no messages and Chat SDK serves history from the state adapter.
- Missing optional callbacks throw `NotImplementedError` (edit, delete, reactions) or no-op (typing). Without `edit`, `stream` buffers and sends once; with `edit`, it returns `null` so core uses post+edit.
- Config callbacks use method syntax so users can annotate `payload` with a narrower type.
- Keep the factory secure by default: it must throw when neither `secret` nor `verify` is set.

## Build, test, typecheck

```bash
pnpm --filter @chat-adapter/webhook build
pnpm --filter @chat-adapter/webhook test
pnpm --filter @chat-adapter/webhook typecheck
```
