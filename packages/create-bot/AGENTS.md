# AGENTS.md

`create-bot` is a CLI tool that scaffolds new [Chat SDK](https://chat-sdk.dev) bot projects.

## Commands

```bash
pnpm --filter create-bot build       # Build with tsup
pnpm --filter create-bot typecheck   # Type-check
pnpm --filter create-bot test        # Run tests with coverage
pnpm -w run check                    # Lint and format (monorepo-wide)
pnpm validate                        # Full validation (build, typecheck, lint, test)
```

## Docs

- [CLI documentation](../../apps/docs/content/docs/create-bot.mdx)
- [Full Chat SDK docs](../../apps/docs/content/docs)
- [Architecture](./ARCHITECTURE.md) for detailed structure, data flow, and design decisions.
