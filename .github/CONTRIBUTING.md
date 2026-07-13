# Contributing

## Reporting issues

For bugs, feature requests, documentation issues, or new adapter requests, [pick an issue template](https://github.com/vercel/chat/issues/new/choose). Each one asks for the information we need to triage the report.

For questions and getting help, see [SUPPORT.md](./SUPPORT.md). Security vulnerabilities should be reported privately — see [SECURITY.md](./SECURITY.md). Do not file a public issue for security issues.

## Building your own adapter

Want to add Chat SDK support for a platform that isn't covered by the official adapters? See [Building a community adapter](https://chat-sdk.dev/docs/contributing/building) for a walkthrough of the `Adapter` interface, testing, packaging, and getting your adapter listed on chat-sdk.dev.

### Package conventions

The repo uses [konsistent](https://www.npmjs.com/package/konsistent) (configured in `.github/konsistent.json`, run via `pnpm konsistent`) to enforce a consistent public surface across adapter and state packages.

**Adapter packages (`packages/adapter-*`)** must:

- Live in `src/index.ts` with a sibling `src/types.ts`
- Import the `Adapter` type from `chat`
- Export a `${Name}Adapter` class that implements `Adapter`
- Export a `create${Name}Adapter` factory function whose parameter is typed `${Name}AdapterConfig`
- Export the `${Name}AdapterConfig` type from `./types`

**State packages (`packages/state-*`)** must:

- Import the `StateAdapter` type from `chat`
- Export a `${Name}StateAdapter` class that implements `StateAdapter`
- Export a `create${Name}State` factory function whose parameter is typed `${Name}StateAdapterOptions`
- Export the `${Name}StateAdapterOptions` type

`${Name}` is the kebab-case package suffix in PascalCase — most cases are mechanical (`discord` → `Discord`), but a few overrides live in `kebabToPascalMap` in the config (e.g. `gchat` → `GoogleChat`, `whatsapp` → `WhatsApp`).

**Example apps (`examples/*`)** must:

- Be marked `"private": true` (they are never published)
- Name their `package.json` `name` field `example-*` (e.g. `example-nextjs-chat`)

The `example-*` name lets the `ignore` glob in `.changeset/config.json` exclude every example from versioning and publishing automatically, so adding a new example needs no changeset and no edit to the changesets config. A test in `packages/integration-tests` asserts every `examples/*` package follows this convention and is in the resolved changesets `ignore` list.

## Signed Commits

All commits to this repository must be **signed and verified**. Pull requests with unsigned commits will not be merged.

GitHub has a guide on setting this up: [Signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits). The easiest path is usually [signing with SSH](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#ssh-commit-signature-verification) using a key you've already added to GitHub.

Verify your setup by checking that new commits show a "Verified" badge on github.com.

## Developer Certificate of Origin (DCO)

In addition to signing, every commit must be **signed off** to certify that you wrote the patch (or otherwise have the right to submit it under the project's license), per the [Developer Certificate of Origin](https://developercertificate.org/).

Sign off by adding the `-s` flag when you commit:

```bash
git commit -s -m "feat: add a thing"
```

This appends a trailer to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must match the author of the commit. To set them once:

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

If the DCO check fails on existing commits, the simplest fixes are to amend (`git commit --amend -s`) or rebase (`git rebase --signoff main`) and force-push. The DCO app also accepts a single remediation commit if you'd rather not rewrite history — follow the instructions in the failed check's details.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `chore:`, etc., optionally with a scope (e.g., `fix(slack): ...`).

The release workflow's auto-generated version PRs also use this convention (`chore(release): version packages`), so keeping new commits consistent makes changelogs and release PRs predictable.

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
pnpm konsistent  # Enforce adapter/state-package shape conventions
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
- **Don't add** for: documentation changes, internal refactors, test changes, CI updates, or changes to example apps (`examples/*` are private and ignored by changesets)

### Changeset Types

| Type    | When to Use                        | Version Bump      |
| ------- | ---------------------------------- | ----------------- |
| `patch` | Bug fixes, minor improvements      | `4.0.0` → `4.0.1` |
| `minor` | New features (backward compatible) | `4.0.0` → `4.1.0` |
| `major` | Breaking changes                   | `4.0.0` → `5.0.0` |

All packages in this monorepo use **fixed versioning** — they always share the same version number, and any release bumps every package together.

## Updating documentation

User-facing docs live in `apps/docs/content/docs/` and render at [chat-sdk.dev/docs](https://chat-sdk.dev/docs). When a PR changes behavior, public APIs, or environment variables, update the relevant page(s) in the same PR.

To preview docs locally:

```bash
pnpm --filter docs dev
```

## Preview Branch Testing

The example app includes a proxy that can forward webhook requests to a preview branch deployment. This allows testing preview branches with real webhook traffic from Slack/Teams/GChat.

### Setup

1. Deploy a preview branch to Vercel (e.g., `https://chat-sdk-git-feature-branch.vercel.app`)
2. Go to `/settings` on the production deployment
3. Enter the preview branch URL and save

### To disable

Clear the URL on the settings page.

### Files

- `examples/nextjs-chat/src/proxy.ts` - The proxy logic
- `examples/nextjs-chat/src/app/settings/page.tsx` - Settings UI
- `examples/nextjs-chat/src/app/api/settings/preview-branch/route.ts` - API to get/set the URL
