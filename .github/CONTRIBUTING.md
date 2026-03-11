# Contributing

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

---

# Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for version management and automated npm publishing.

## How Changesets Work

Changesets is a tool that manages versioning and changelogs for monorepos. The workflow is:

1. **Contributors add changesets** when making changes that should trigger a release
2. **CI creates a "Version Packages" PR** that accumulates all changesets
3. **Merging the Version PR** triggers npm publishing

## For Contributors

### Adding a Changeset

When you make a change that should be released (bug fix, new feature, breaking change), run:

```bash
pnpm changeset
```

This interactive CLI will ask:

1. **Which packages changed?** - Select affected packages (space to select, enter to confirm)
2. **Bump type?** - `major` (breaking), `minor` (feature), or `patch` (fix)
3. **Summary** - A brief description for the changelog

This creates a markdown file in `.changeset/` describing your change. Commit this file with your PR.

### Example

```bash
$ pnpm changeset

🦋  Which packages would you like to include?
   ◯ @chat-adapter/gchat
   ◉ @chat-adapter/slack
   ◯ @chat-adapter/teams
   ...

🦋  Which packages should have a major bump?
   (Press <space> to select, <enter> to proceed)

🦋  Which packages should have a minor bump?
   ◉ @chat-adapter/slack

🦋  Please enter a summary for this change:
   Added support for file uploads in Slack

🦋  Summary: Added support for file uploads in Slack

🦋  === Summary of changesets ===
🦋  minor: @chat-adapter/slack

🦋  Is this your desired changeset? (Y/n) Y
🦋  Changeset added!
```

### When to Add a Changeset

- **Do add** for: bug fixes, new features, breaking changes, dependency updates affecting behavior
- **Don't add** for: documentation changes, internal refactors, test changes, CI updates

### Changeset Types

| Type    | When to Use                        | Version Bump      |
| ------- | ---------------------------------- | ----------------- |
| `patch` | Bug fixes, minor improvements      | `4.0.0` → `4.0.1` |
| `minor` | New features (backward compatible) | `4.0.0` → `4.1.0` |
| `major` | Breaking changes                   | `4.0.0` → `5.0.0` |

## Automated Release Process

### How It Works

1. When PRs with changesets are merged to `main`, CI runs
2. The `changesets/action` detects pending changesets
3. It creates/updates a "Version Packages" PR with:
   - Version bumps in `package.json` files
   - Updated `CHANGELOG.md` files
   - Consumed changeset files (deleted)
4. When you merge the "Version Packages" PR:
   - CI runs again
   - Packages are published to npm
   - Git tags are created

### Fixed Versioning

All packages in this monorepo use **fixed versioning** (configured in `.changeset/config.json`):

```json
"fixed": [["chat", "@chat-adapter/*"]]
```

This means **all packages always have the same version number**. When any package is released, all packages are released together with the same version bump.

## Required Secrets

The GitHub Actions workflow requires these secrets:

### `NPM_TOKEN` (Required)

An npm access token with publish permissions for the `@chat-adapter` scope and `chat` package.

**To create:**

1. Go to [npmjs.com](https://www.npmjs.com/) → Account Settings → Access Tokens
2. Click "Generate New Token" → "Classic Token"
3. Select **Automation** type (for CI/CD)
4. Copy the token

**To add to GitHub:**

1. Go to your repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `NPM_TOKEN`
4. Value: paste your npm token
5. Click "Add secret"

### `GITHUB_TOKEN` (Automatic)

This is automatically provided by GitHub Actions. No setup needed.

It's used to:

- Create the "Version Packages" PR
- Push version commits
- Create git tags

## Manual Publishing (Emergency)

If you need to publish manually (not recommended):

```bash
# Ensure you're logged in to npm
npm login

# Build all packages
pnpm build

# Run changeset version to update versions
pnpm changeset version

# Publish to npm
pnpm changeset publish
```

## Configuration

The changeset config is in `.changeset/config.json`:

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [["chat", "@chat-adapter/*"]],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["example-nextjs-chat", "@chat-adapter/integration-tests"]
}
```

| Option                       | Value                           | Description                            |
| ---------------------------- | ------------------------------- | -------------------------------------- |
| `access`                     | `"public"`                      | Publish scoped packages publicly       |
| `baseBranch`                 | `"main"`                        | Branch to compare against              |
| `fixed`                      | `[["chat", "@chat-adapter/*"]]` | All packages always have same version  |
| `ignore`                     | `["example-nextjs-chat", ...]`  | Don't publish these packages           |
| `updateInternalDependencies` | `"patch"`                       | Auto-bump dependents on patch releases |

## Troubleshooting

### "npm ERR! 403 Forbidden"

- Check that `NPM_TOKEN` secret is set correctly
- Verify the token has publish permissions
- Ensure you're a member of the `@chat-adapter` npm organization

### "Version Packages" PR not created

- Ensure there are changeset files in `.changeset/`
- Check that the workflow ran successfully
- Verify `GITHUB_TOKEN` has write permissions

### Packages not publishing

- Check the "Version Packages" PR was merged (not just changesets)
- Verify all tests pass in CI
- Check npm for rate limiting issues

## First Release Checklist

Before the first publish:

1. [ ] Create the `@chat-adapter` organization on npm
2. [ ] Add team members to the npm org
3. [ ] Generate an npm automation token
4. [ ] Add `NPM_TOKEN` secret to GitHub
5. [ ] Verify all `package.json` files have `"publishConfig": { "access": "public" }`
6. [ ] Run `pnpm changeset` to create initial changeset
7. [ ] Merge to main and watch the magic happen
