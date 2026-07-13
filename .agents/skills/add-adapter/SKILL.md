---
name: add-adapter
description: Add a vendor-official or community adapter to the Chat SDK catalog and docs — adapters.json registry, chat/adapters catalog entry, the docs MDX page, meta.json, integration-test lists, and a changeset. Use when a developer wants to add, list, register, or submit a third-party (vendor-official or community) adapter to this repo, add an adapter to the catalog, or create or edit an adapter docs page under apps/docs/content/adapters/vendor-official or apps/docs/content/adapters/community.
---

# Add a catalog adapter (vendor-official or community)

Use this to list a **third-party** adapter in the Chat SDK catalog and docs. It is not for building a first-party `packages/adapter-*` package.

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

- **community** — listed in the docs only. No `chat/adapters` catalog entry, no changeset.
- **vendor-official** — a maintained/blessed adapter. Everything community has, plus a `chat/adapters` catalog entry, a matching `create-chat-sdk` scaffold-spec entry, and a changeset. Frontmatter adds `vendorOfficial: true` and `author`.

## Files to change

`<tier>` is `vendor-official` or `community`.

1. **`apps/docs/content/adapters/<tier>/<slug>.mdx`** — the docs page. Start from [assets/adapter.mdx](assets/adapter.mdx). The filename basename must equal the `slug` frontmatter field, and the page must render `<FeatureSupport />`.
2. **`apps/docs/content/adapters/<tier>/meta.json`** — add `"<slug>"` to the `pages` array.
3. **`apps/docs/adapters.json`** — add a registry entry: `name`, `slug`, `type`, `community: true`, `description`, `packageName`, `author`, `readme` (the GitHub URL). Add `vendorOfficial: true` for vendor-official.
4. **`packages/integration-tests/src/docs-adapters.test.ts`** — add `"<slug>"` to the hardcoded expected list for its tier.
5. **`packages/integration-tests/src/documentation-test-utils.ts`** — add the `packageName` to `VALID_DOC_PACKAGES`, plus every import specifier used in the MDX code blocks (subpaths count separately).

**Vendor-official also:**

6. **`packages/chat/src/adapters/index.ts`** — add an `ADAPTERS` entry with `group: "vendor-official"`. Reuse the `env`/`secretEnv`/`urlEnv` helpers; use `env: { notes: "…" }` when there are no env vars. See `packages/chat/src/adapters/AGENTS.md`.
7. **`packages/create-chat-sdk/src/catalog/scaffold-spec.ts`** — add a matching `"<slug>": { invocation: … }` entry, modeled on a similar adapter. This is a required registration step, not a behavior change: the object is `satisfies Record<AdapterSlug, …>`, so every catalog slug must have one or `create-chat-sdk` fails to type-check.
8. **`.changeset/<slug>-adapter.md`** — `"chat": patch` + `"create-chat-sdk": patch`, one line describing the addition.

## Invariants the tests enforce

- **Registry ↔ catalog parity.** `Object.keys(ADAPTERS)` must equal the adapters.json slugs where `!community || vendorOfficial`. So vendor-official **must** be in `chat/adapters`; community-only **must not** be. This is why community adapters skip steps 6–8.
- **peerDeps ↔ PackageInstall.** The catalog entry's `peerDeps` (sorted) must exactly equal the extra packages in the MDX `<PackageInstall package="…" />`, after removing the adapter's own `packageName`, `chat`, and any `@chat-adapter/state-*`. Easiest: `peerDeps: []`, install only `<packageName> chat` (plus a state adapter) in `PackageInstall`, and keep any other imports in fenced code blocks.
- **Fields match.** `packageName`, `type`, `community`, and `vendorOfficial` must match between the MDX frontmatter and the adapters.json entry.
- **Required frontmatter:** `title`, `description`, `packageName`, `slug`, `tagline`, `type` (`platform` | `state`), `mdxBody: true`, `community: true` (plus `vendorOfficial: true` and `author` for vendor-official).
- **Imports.** Every import in an MDX code block must be listed in `VALID_DOC_PACKAGES`.

## Validate

```bash
pnpm --filter chat build            # regenerate the catalog the tests import
pnpm --filter @chat-adapter/integration-tests test
pnpm --filter chat typecheck
pnpm --filter create-chat-sdk typecheck   # vendor-official only
pnpm check && pnpm konsistent
```

## Resources

- MDX template: [assets/adapter.mdx](assets/adapter.mdx)
- Catalog conventions: `packages/chat/src/adapters/AGENTS.md`
- Examples to copy: `apps/docs/content/adapters/vendor-official/` and `apps/docs/content/adapters/community/`
