# Contributing

## Signed Commits

All commits to this repository must be **signed and verified**. Pull requests with unsigned commits will not be merged.

GitHub has a guide on setting this up: [Signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits). The easiest path is usually [signing with SSH](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#ssh-commit-signature-verification) using a key you've already added to GitHub.

Verify your setup by checking that new commits show a "Verified" badge on github.com.

## Development

### Testing

Run all unit tests across every package in a single Vitest Workspace run:

```bash
pnpm test:workspace
```

This produces one combined report covering all 11 unit-test packages. Integration tests (`@chat-adapter/integration-tests`) are excluded since they require platform credentials.

You can also run tests per-package via Turborepo:

```bash
# All packages (including integration tests)
pnpm test

# Single package
pnpm --filter chat test
pnpm --filter @chat-adapter/slack test
```

### Other commands

```bash
pnpm check       # Check all packages (linting and formatting)
pnpm typecheck   # Type-check all packages
pnpm knip        # Check for unused exports/dependencies
pnpm validate    # Run everything (knip, lint, typecheck, test, build)
```

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for version management. **Every PR that changes a package's behavior must include a changeset.**

### Adding a Changeset

When you make a change that should be released (bug fix, new feature, breaking change), run:

```bash
pnpm changeset
```

This interactive CLI will ask:

1. **Which packages changed?** — Select affected packages (space to select, enter to confirm)
2. **Bump type?** — `major` (breaking), `minor` (feature), or `patch` (fix)
3. **Summary** — A brief description for the changelog

This creates a markdown file in `.changeset/` describing your change. Commit this file with your PR.

### When to Add a Changeset

- **Do add** for: bug fixes, new features, breaking changes, dependency updates affecting behavior
- **Don't add** for: documentation changes, internal refactors, test changes, CI updates

### Changeset Types

| Type    | When to Use                        | Version Bump      |
| ------- | ---------------------------------- | ----------------- |
| `patch` | Bug fixes, minor improvements      | `4.0.0` → `4.0.1` |
| `minor` | New features (backward compatible) | `4.0.0` → `4.1.0` |
| `major` | Breaking changes                   | `4.0.0` → `5.0.0` |

All packages in this monorepo use **fixed versioning** — they always share the same version number, and any release bumps every package together.

## Preview Branch Testing

The example app includes a middleware that can proxy webhook requests to a preview branch deployment. This allows testing preview branches with real webhook traffic from Slack/Teams/GChat.

### Setup

1. Deploy a preview branch to Vercel (e.g., `https://chat-sdk-git-feature-branch.vercel.app`)
2. Go to `/settings` on the production deployment
3. Enter the preview branch URL and save

### To disable

Clear the URL on the settings page.

### Files

- `examples/nextjs-chat/src/middleware.ts` - The proxy middleware
- `examples/nextjs-chat/src/app/settings/page.tsx` - Settings UI
- `examples/nextjs-chat/src/app/api/settings/preview-branch/route.ts` - API to get/set the URL
