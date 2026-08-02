# AGENTS.md — `@chat-adapter/instagram`

Follow the repository-level `AGENTS.md` plus these package-specific rules.

## Scope

This package integrates Instagram Direct Messages through the native Instagram
API with Instagram Login (`graph.instagram.com`). Do not switch outbound calls
to the Facebook Graph host or use Page access tokens.

## Contracts

- Factory: `createInstagramAdapter`
- Adapter name: `instagram`
- Thread ID: `instagram:{professionalAccountId}:{igsid}`
- Webhook object: `instagram`
- Required permissions: `instagram_business_basic` and
  `instagram_business_manage_messages`
- Required env vars: `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET`,
  `INSTAGRAM_VERIFY_TOKEN`, `INSTAGRAM_ACCOUNT_ID`

## Platform constraints

- A customer must initiate the conversation.
- Standard sends are limited to 24 hours after the customer's latest inbound
  message.
- `HUMAN_AGENT` is for audited human support only and extends the window to
  seven days.
- Group DMs, editing, deletion, and modals are unsupported.
- Text is at most 1000 UTF-8 bytes.
- Images are at most 8 MB; audio, video, and PDF files are at most 25 MB.

## Testing

Mock `fetch`; unit tests must not call Meta. Add representative webhook payloads
to `sample-messages.md` and replay coverage when adding an event shape.

```bash
pnpm --filter @chat-adapter/instagram test
pnpm --filter @chat-adapter/instagram typecheck
pnpm --filter @chat-adapter/instagram build
```

Never log access tokens, app secrets, webhook signatures, or media URLs that
may contain temporary credentials.
