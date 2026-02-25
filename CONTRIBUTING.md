# Contributing to Chat SDK

## Setup

```bash
pnpm install
pnpm build
```

## Development

```bash
pnpm dev       # Watch mode
pnpm test      # Run tests
pnpm validate  # Full validation (lint, typecheck, test, build)
```

Always run `pnpm validate` before declaring a task done.

## Changesets (Release Flow)

This monorepo uses [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs. **Every PR that changes a package's behavior must include a changeset.**

### Creating a changeset

```bash
pnpm changeset
```

You'll be prompted to:

1. **Select the affected package(s)** — choose which packages your change touches (e.g., `@chat-adapter/slack`, `chat`)
2. **Choose the semver bump** — `patch` for fixes, `minor` for new features, `major` for breaking changes
3. **Write a summary** — a short description of the change (this goes into the CHANGELOG)

This creates a markdown file in `.changeset/` — commit it with your PR.

### When to use which bump

| Bump | Use for | Example |
|------|---------|---------|
| `patch` | Bug fixes, internal refactors with no API change | Fix race condition in thread locking |
| `minor` | New features, new exports, new options | Add custom installation prefix support |
| `major` | Breaking changes (removed exports, changed signatures) | Rename `createAdapter` to `createSlackAdapter` |

### Example

```bash
pnpm changeset
# → select: @chat-adapter/slack
# → bump: minor
# → summary: Add custom installation prefix support for preview deployments
```

### Publishing (maintainers)

When changesets are merged to `main`, the Changesets GitHub Action opens a "Version Packages" PR that bumps versions and updates CHANGELOGs. Merging that PR triggers publishing to npm.

## Code Style

This project uses [Ultracite](https://github.com/haydenbleasel/ultracite) for linting and formatting:

```bash
pnpm check   # Check for issues
pnpm fix     # Auto-fix issues
```

See `CLAUDE.md` for full code style guidelines.
