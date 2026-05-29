# AGENTS.md

`create-chat-sdk` is a CLI tool that scaffolds new [Chat SDK](https://chat-sdk.dev) bot projects.

## Commands

```bash
pnpm --filter create-chat-sdk build       # Build with tsup
pnpm --filter create-chat-sdk typecheck   # Type-check
pnpm --filter create-chat-sdk test        # Run tests with coverage
pnpm -w run check                         # Lint and format (monorepo-wide)
pnpm validate                             # Full validation (build, typecheck, lint, test)
```

## Docs

- [CLI documentation](../../apps/docs/content/docs/create-chat-sdk.mdx)
- [Full Chat SDK docs](../../apps/docs/content/docs)
- [Architecture](./ARCHITECTURE.md) for detailed structure, data flow, and design decisions.
