# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Build commands

```bash
pnpm install
pnpm build           # Build all packages (Turborepo)
pnpm typecheck       # Type-check all packages
pnpm check           # Lint and format check (ultracite/biome)
pnpm fix             # Auto-fix lint/format issues
pnpm knip            # Check for unused exports/dependencies
pnpm test            # Run all tests
pnpm validate        # knip + check + typecheck + test + build. ALWAYS run before declaring a task done.
pnpm dev             # Watch mode

# Per-package
pnpm --filter chat test
pnpm --filter @chat-adapter/slack build
pnpm --filter docs dev    # Preview the docs site (chat-sdk.dev) locally
```

## Code style

- Install dependencies with `pnpm add`, not by editing `package.json` by hand.
- `sample-messages.md` files in adapter packages contain real-world webhook logs — useful when writing parsers or fixtures.
- Commits must be **signed and verified** — see `.github/CONTRIBUTING.md`.
- We follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, optionally scoped). The release workflow's auto-PR uses `chore(release): version packages` — don't reuse that exact subject for unrelated commits.
- See the Ultracite section at the bottom for the in-code style rules Biome doesn't catch automatically.

## Architecture

pnpm monorepo, Turborepo orchestrated. All packages are ESM (`"type": "module"`), TypeScript, bundled with **tsup**.

### Packages

- `packages/chat` — core SDK (`chat` npm package): `Chat` class, types, mdast-based markdown utilities
- `packages/adapter-{slack,teams,gchat,discord,telegram,whatsapp,github,linear,zoom}` — platform adapters
- `packages/adapter-shared` — utilities shared across adapters
- `packages/state-{memory,redis,ioredis,pg}` — state adapters
- `packages/integration-tests` — integration tests against real platform APIs
- `apps/docs` — fumadocs-based docs site (chat-sdk.dev)
- `examples/nextjs-chat` — example Next.js app

### Core concepts

1. **Chat** (`packages/chat/src/chat.ts`) — main entry point; coordinates adapters and handlers.
2. **Adapter** — platform-specific implementation: webhook verification + parsing, normalized format conversion, `FormatConverter` for markdown ↔ platform AST.
3. **StateAdapter** — persistence for subscriptions, distributed locks, key/value cache, lists, and queues.
4. **Thread** — conversation thread with `post()`, `subscribe()`, `startTyping()`, `setState()`, etc.
5. **Message** — normalized message: `text`, `formatted` (mdast AST), `raw` (platform-specific).

### Thread ID format

`{adapter}:{channel}:{thread}` — e.g. `slack:C123ABC:1234567890.123456`. Some adapters base64-encode IDs that contain delimiters (Teams, Google Chat).

### Webhook flow

1. Platform → `/api/webhooks/{platform}`
2. Adapter verifies, parses, calls `chat.handleIncomingMessage()`
3. `Chat` acquires a thread lock, then routes to `onSubscribedMessage`, `onNewMention`, or `onNewMessage` handlers depending on context.
4. Handler receives `Thread` and `Message`.

### Formatting

Messages use **mdast** as the canonical format. Each adapter's `FormatConverter` provides:

- `toAst(platformText)` — platform → mdast
- `fromAst(ast)` — mdast → platform
- `renderPostable(message)` — `PostableMessage` → platform string

## Testing

`packages/chat/src/mock-adapter.ts` exports test utilities:

- `createMockAdapter(name)` — `Adapter` with `vi.fn()` mocks
- `createMockState()` — in-memory subscriptions/locks/cache
- `createTestMessage(id, text, overrides?)`
- `mockLogger`

For production-traffic-driven testing, see `packages/integration-tests/fixtures/replay/README.md` (recording / export / replay workflow). Recordings are tagged with the deployed git SHA and exported via `pnpm recording:list` / `pnpm recording:export <session-id>` from `examples/nextjs-chat`.

## Documentation

User-facing docs live in `apps/docs/content/docs/` (rendered at chat-sdk.dev/docs). When changing behavior, public APIs, or env vars, update the relevant page in the same PR. Preview locally with `pnpm --filter docs dev`.

## Releases

Uses Changesets with fixed versioning (every package shares one version). Every PR that changes a package's behavior must include a changeset (`pnpm changeset`). Full rules in `.github/CONTRIBUTING.md`.

## Environment variables

Key env vars (see `turbo.json` for the full list):

- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID`
- `GOOGLE_CHAT_CREDENTIALS` or `GOOGLE_CHAT_USE_ADC`
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`
- `REDIS_URL` — Redis state adapter
- `POSTGRES_URL` / `DATABASE_URL` — PostgreSQL state adapter
- `BOT_USERNAME` — default bot username

## Community health files

- `.github/CONTRIBUTING.md` — dev setup, signed commits, conventional commits, changesets, docs preview, building your own adapter
- `.github/SUPPORT.md` — where to send help/usage questions
- `.github/SECURITY.md` — private vulnerability reporting
- `.github/ISSUE_TEMPLATE/` — bug, feature, docs, and adapter-request templates
- `.github/CODEOWNERS` — `@vercel/chat-sdk` owns everything; release plumbing is locked to `@cramforce`

## Ultracite code standards

This project uses [Ultracite](https://github.com/haydenbleasel/ultracite) (Biome-based). `pnpm check` / `pnpm fix` run it across the monorepo. Most issues auto-fix.

Beyond what Biome enforces:

- **Type safety** — prefer `unknown` over `any`; `as const` for literals; named constants over magic numbers.
- **Modern JS/TS** — `for...of` over `.forEach`; `?.` and `??`; `const` by default; template literals; destructure.
- **Async** — always `await` returned promises; no async Promise executors.
- **React** — function components only; hooks at top level; stable `key`s (prefer IDs over indices); no components defined inside other components; semantic HTML and ARIA; `<Image>` over `<img>`; ref-as-prop in React 19+.
- **Errors** — throw `Error` objects with descriptive messages; early returns over nested conditionals; no `console.log` / `debugger` / `alert` in shipped code.
- **Performance** — top-level regex literals; no spread-in-accumulator loops; specific imports over barrel files.
- **Security** — `rel="noopener"` on `target="_blank"`; avoid `dangerouslySetInnerHTML`; never `eval()` or assign to `document.cookie`.
