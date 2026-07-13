# Coding Agent Guidance

`create-chat-sdk` is a CLI tool that scaffolds new [Chat SDK](https://chat-sdk.dev) bot projects.

## Commands

```bash
pnpm --filter create-chat-sdk build       # Build with tsup
pnpm --filter create-chat-sdk typecheck   # Type-check
pnpm --filter create-chat-sdk test        # Run tests with coverage
pnpm --filter create-chat-sdk test -- src/cli/e2e.test.ts  # Scaffold every catalog adapter through the CLI path
pnpm -w run check                         # Lint and format (monorepo-wide)
pnpm validate                             # Full validation (build, typecheck, lint, test)
```

## Architecture

- Adapter metadata comes from `chat/adapters`; do not add a second registry.
- CLI-only scaffold behavior belongs in `src/catalog/scaffold-spec.ts` and must remain exhaustive with `satisfies Record<AdapterSlug, CliScaffoldSpec>`.
- The template is webhook-only. Do not add pages, layouts, or client UI.
- `src/lib/bot.ts`, `.env.example`, `next.config.ts`, and README content are generated from selected adapters.

## Docs

- [CLI documentation](../../apps/docs/content/docs/create-chat-sdk.mdx) is the public docs source of truth.
- `docs/create-chat-sdk.mdx` is the packaged copy of the public CLI docs. Keep it in sync with the source docs page.
- [Full Chat SDK docs](../../apps/docs/content/docs)
- [Architecture](./ARCHITECTURE.md) for detailed structure, data flow, and design decisions.
