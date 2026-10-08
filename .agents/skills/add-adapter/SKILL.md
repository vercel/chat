---
name: add-adapter
description: Add a vendor-official or community adapter to the Chat SDK catalog and docs — the @chat-adapter/catalog entry (listing metadata and capabilities), the docs MDX page, meta.json, and a changeset. Use when a developer wants to add, list, register, or submit a third-party (vendor-official or community) adapter to this repo, add an adapter to the catalog, or create or edit an adapter docs page under apps/docs/content/adapters/vendor-official or apps/docs/content/adapters/community.
metadata:
  internal: true
---

# Add a catalog adapter (vendor-official or community)

Use this to list a **third-party** adapter in the Chat SDK catalog and docs. It is not for building a first-party `packages/adapter-*` package.

**Required:** load the `technical-writer` skill ([../technical-writer/SKILL.md](../technical-writer/SKILL.md)) before writing any prose: the docs page, frontmatter `tagline` and `description`, the changeset, commit messages, and the PR description. Follow its editorial standards alongside the sourcing rules below.

## Gather the source — never invent details

Ask the user for:

1. Their adapter's **GitHub repository URL**.
2. Their **docs or README**.

Read both. Everything you write into the catalog and docs must come **directly** from those sources or from the user. Do not assume or guess any information:

- **`packageName`** — read it from the repo's `package.json`, verbatim.
- **Factory export** (e.g. `createFooAdapter`) — read it from the package's exports/source. Do not guess it from the display name.
- **`type`** (`platform` or `state`), **env vars**, and the **feature matrix** — base these on what the code and README actually document.
- **Install and usage snippets** — take them from the README; do not write example code the adapter may not support.

If the repo or README does not make something clear, **stop and ask the user** rather than filling it in. When in doubt, ask.

Choose the `slug` (kebab-case) and confirm it is not already taken: `ls apps/docs/content/adapters/*/`.

## Pick the tier

- **community** — listed in the docs. A `CommunityAdapter` entry in `@chat-adapter/catalog` (listing metadata and capabilities only), no scaffold spec.
- **vendor-official** — a maintained/blessed adapter. A full `CatalogAdapter` entry with setup metadata (factory export, peer deps, env vars), a matching `create-chat-sdk` scaffold-spec entry, and a changeset. Frontmatter adds `vendorOfficial: true` and `author`.

## Files to change

`<tier>` is `vendor-official` or `community`.

1. **`apps/docs/content/adapters/<tier>/<slug>.mdx`**: the docs page. Start from [assets/adapter.mdx](assets/adapter.mdx) for a platform adapter or [assets/adapter-state.mdx](assets/adapter-state.mdx) for a state adapter, and follow the section order and names in [references/page-layout.md](references/page-layout.md). The filename basename must equal the `slug` frontmatter field, and the page must render `<FeatureSupport />`.
2. **`apps/docs/content/adapters/<tier>/meta.json`** — add `"<slug>"` to the `pages` array.
3. **`packages/catalog/src/adapters/<tier>/<slug>.ts`** — the catalog entry: `name`, `slug`, `type`, `group`, `description`, `packageName`, `author`, `readme` (the GitHub URL, pinned to a commit or tag), and `features` (the capability matrix the docs page renders). Copy a neighbor in the same folder. Then register it in `packages/catalog/src/adapters/index.ts`: `COMMUNITY_ADAPTERS` for community, `ADAPTERS` for vendor-official. See `packages/catalog/AGENTS.md`.

**Vendor-official also:**

4. **Setup fields in the catalog entry** — `factoryExport`, `peerDeps`, optional `importPath`, and `env`. Reuse the `env`/`secretEnv`/`urlEnv` helpers from `packages/catalog/src/env.ts`; use `env: { notes: "…" }` when there are no env vars.
5. **`packages/create-chat-sdk/src/catalog/scaffold-spec.ts`** — add a matching `"<slug>": { invocation: … }` entry, modeled on a similar adapter. This is a required registration step, not a behavior change: the object is `satisfies Record<AdapterSlug, …>`, so every catalog slug must have one or `create-chat-sdk` fails to type-check.
6. **`.changeset/<slug>-adapter.md`** — `"@chat-adapter/catalog": patch` + `"create-chat-sdk": patch`, one line describing the addition. Community listings ship in the published catalog too, so add a `"@chat-adapter/catalog": patch` changeset for them as well.

## Invariants the tests enforce

- **Docs ↔ catalog parity.** Every adapter MDX page has a catalog entry in the matching `group`, and every catalog entry has a page. Vendor-official entries go in `ADAPTERS`; community entries go in `COMMUNITY_ADAPTERS`. This is why community adapters skip steps 4 and 5.
- **peerDeps ↔ PackageInstall.** The catalog entry's `peerDeps` (sorted) must exactly equal the extra packages in the MDX `<PackageInstall package="…" />`, after removing the adapter's own `packageName`, `chat`, and any `@chat-adapter/state-*`. Easiest: `peerDeps: []`, install only `<packageName> chat` (plus a state adapter) in `PackageInstall`, and keep any other imports in fenced code blocks.
- **Fields match.** `packageName`, `type`, and `author` (when set in frontmatter) must match between the MDX frontmatter and the catalog entry.
- **Capabilities live in the catalog.** Frontmatter must not declare `features`; `<FeatureSupport />` reads them from the catalog entry. Only keys from `PLATFORM_FEATURE_CATEGORIES` or `STATE_FEATURE_CATEGORIES` (matching the adapter `type`) are allowed.
- **Required frontmatter:** `title`, `description`, `packageName`, `slug`, `tagline`, `type` (`platform` | `state`), `mdxBody: true`, `community: true` (plus `vendorOfficial: true` and `author` for vendor-official).

## Validate

```bash
pnpm --filter @chat-adapter/catalog build   # regenerate the catalog the tests import
pnpm --filter @chat-adapter/catalog test
pnpm --filter @chat-adapter/integration-tests test
pnpm --filter create-chat-sdk typecheck   # vendor-official only
pnpm check && pnpm konsistent
```

## Resources

- Human guide (vendor-official): `apps/docs/content/docs/contributing/vendor-official.mdx`
- Human guide (community listing): `apps/docs/content/docs/contributing/publishing.mdx`
- MDX templates: [assets/adapter.mdx](assets/adapter.mdx) (platform) and [assets/adapter-state.mdx](assets/adapter-state.mdx) (state)
- Page layout and section names: [references/page-layout.md](references/page-layout.md)
- Writing standards (required): [technical-writer skill](../technical-writer/SKILL.md)
- Catalog conventions: `packages/catalog/AGENTS.md`
- Examples to copy: `apps/docs/content/adapters/vendor-official/` and `apps/docs/content/adapters/community/`
