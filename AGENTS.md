# AGENTS.md

Guidance for coding agents working in this repository. For PR workflow, signed commits, and changeset rules, see [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Commands

```bash
pnpm install
pnpm validate        # knip + check + typecheck + test + build — run before declaring work done
pnpm check           # lint/format (Ultracite/Biome)
pnpm fix             # auto-fix lint/format issues
pnpm typecheck
pnpm test            # all package tests via Turborepo (includes integration-tests)
pnpm test:workspace  # single Vitest run across unit-test packages only
pnpm build
pnpm dev             # watch mode
pnpm knip            # unused exports/dependencies
pnpm konsistent      # adapter/state package shape (see .github/konsistent.json)

# Per-package
pnpm --filter chat test
pnpm --filter @chat-adapter/slack build
pnpm --filter docs dev    # preview chat-sdk.dev locally
```

Install dependencies with `pnpm add`, not by editing `package.json` by hand.

## Monorepo layout

pnpm + Turborepo monorepo. Packages are ESM (`"type": "module"`), TypeScript, bundled with **tsup**.

| Path | Role |
| --- | --- |
| `packages/chat` | Core SDK (`chat`): `Chat`, types, mdast markdown |
| `packages/catalog` | `@chat-adapter/catalog`: static adapter catalog (listing metadata, capabilities, setup requirements) |
| `packages/adapter-*` | Platform adapters (slack, teams, gchat, discord, telegram, whatsapp, github, linear, web, messenger, twilio, …) |
| `packages/adapter-shared` | Shared adapter utilities |
| `packages/state-*` | State adapters (memory, redis, ioredis, pg) |
| `packages/create-chat-sdk` | `create-chat-sdk` CLI scaffold |
| `packages/tests` | `@chat-adapter/tests` — Vitest factories/matchers for adapter tests |
| `packages/integration-tests` | Replay + emulator tests; needs credentials for live API tests |
| `apps/docs` | fumadocs site (chat-sdk.dev) |
| `examples/*` | Example bots; `package.json` `name` must be `example-*` (private, no changeset) |

When editing a specific package, read its **AGENTS.md** if present (most adapters, state packages, `create-chat-sdk`, and `packages/catalog` have one).

## Architecture

### Core concepts

1. **Chat** (`packages/chat/src/chat.ts`) — coordinates adapters and handlers.
2. **Adapter** — webhook verification, parsing, and a `FormatConverter` for markdown ↔ platform format.
3. **StateAdapter** — subscriptions, distributed locks, key/value cache, lists, queues.
4. **Thread** — conversation handle: `post()`, `subscribe()`, `startTyping()`, `setState()`, etc.
5. **Message** — normalized message: `text`, `formatted` (mdast AST), `raw` (platform-specific).

### Thread IDs

`{adapter}:{channel}:{thread}` — e.g. `slack:C123ABC:1234567890.123456`. Some adapters base64-encode IDs that contain delimiters (Teams, Google Chat).

### Webhook flow

1. Platform → `/api/webhooks/{platform}`
2. Adapter verifies and parses; calls `chat.handleIncomingMessage()`
3. `Chat` acquires a thread lock, then routes to `onSubscribedMessage`, `onNewMention`, or `onNewMessage`
4. Handler receives `Thread` and `Message`

### Formatting

**mdast** is the canonical message format. Each adapter's `FormatConverter` implements `toAst`, `fromAst`, and `renderPostable`.

### Adapter catalog

`@chat-adapter/catalog` (`packages/catalog`) is the single source of truth for adapter metadata: the docs adapter listing, the feature matrices on adapter pages, and `create-chat-sdk` all read from it. `chat/adapters` is a deprecated re-export. See [packages/catalog/AGENTS.md](packages/catalog/AGENTS.md) when adding or changing catalog entries.

## Working on adapters and state packages

- Run `pnpm konsistent` after changing public exports; conventions are documented in [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md#package-conventions).
- `sample-messages.md` in adapter packages holds real webhook payloads — extend it when fixing parsers or adding event support.
- Adapter factory/config naming: `create${Name}Adapter`, `${Name}Adapter`, `${Name}AdapterConfig` (see konsistent config for `gchat` → `GoogleChat` etc.).

## Testing

`packages/chat/src/mock-adapter.ts`:

- `createMockAdapter(name)`, `createMockState()`, `createTestMessage()`, `mockLogger`

For production-traffic replay tests, see [packages/integration-tests/fixtures/replay/README.md](packages/integration-tests/fixtures/replay/README.md). Recordings export via `pnpm recording:list` / `pnpm recording:export <session-id>` from `examples/nextjs-chat`.

## Docs and releases

- Always use the `technical-writer` skill ([.agents/skills/technical-writer/SKILL.md](.agents/skills/technical-writer/SKILL.md)) when you write or edit prose for this repo, including docs pages, READMEs, changesets, commit messages, PR descriptions, and issues.
- User-facing docs: `apps/docs/content/` → [chat-sdk.dev/docs](https://chat-sdk.dev/docs). Update relevant pages when behavior, public APIs, or env vars change.
- Behavioral package changes need a changeset (`pnpm changeset`). Docs-only, tests-only, CI, and `examples/*` changes do not.

## Code style

Ultracite (Biome) via `pnpm check` / `pnpm fix`. Most issues auto-fix.

Beyond Biome: prefer `unknown` over `any`; top-level regex literals; `for...of` over `.forEach`; always `await` returned promises; no `console.log` / `debugger` in shipped code; throw descriptive `Error` objects. React (docs/examples): function components, stable keys, semantic HTML/ARIA.
