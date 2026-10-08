# AGENTS.md - `@chat-adapter/catalog`

Guidance for coding agents working on the adapter catalog package.

## Purpose

`@chat-adapter/catalog` is the single source of truth for adapter metadata. It is a static, zero-dependency module that lists every adapter on chat-sdk.dev (official, vendor-official, and community) with its listing metadata and capabilities. Official and vendor-official entries also carry setup metadata: factory export, peer dependencies, and environment variables.

It is consumed by:

- `apps/docs`: the `/adapters` listing, the `<FeatureSupport />` tables on adapter pages, and the global feature matrix. The docs app resolves it from source through a `tsconfig.json` path alias.
- `create-chat-sdk`: adapter prompts, generated `bot.ts`, `.env.example`, and dependencies. Bundled into the CLI by tsup.
- `chat/adapters`: a deprecated re-export of the original official and vendor-official API.
- External consumers through npm.

## Layout

| Path | Contents |
| --- | --- |
| `src/index.ts` | Public API: lookups, filters, env helpers, and re-exports |
| `src/types.ts` | `AdapterListing`, `CatalogAdapter`, `CommunityAdapter`, env spec types |
| `src/features.ts` | Capability keys, display categories, and normalization |
| `src/env.ts` | Internal helpers for declaring env vars (not exported from the package) |
| `src/adapters/<group>/<slug>.ts` | One file per adapter |
| `src/adapters/index.ts` | `ADAPTERS` (official and vendor-official) and `COMMUNITY_ADAPTERS`, in chat-sdk.dev listing order |

## Maintenance rules

- Keep the package self-contained. Do not import adapter packages, state packages, docs code, Node APIs, or platform SDKs from `src/`. Tests (`*.test.ts`) are the exception: `src/index.test.ts` reads sibling adapter packages from disk to check catalog data against their source, `package.json`, and exports.
- Each adapter must have a docs page at `apps/docs/content/adapters/<group>/<slug>.mdx` with matching `packageName`, `type`, and `author`. Capabilities live only in the catalog `features` field; adapter frontmatter must not declare `features`.
- Use only capability keys from `PLATFORM_FEATURE_CATEGORIES` or `STATE_FEATURE_CATEGORIES` that match the adapter `type`. Omitted keys mean `"no"`. To add a capability, add it to the relevant category in `src/features.ts`; the docs tables pick it up automatically.
- Keep `factoryExport` aligned with the package's actual named factory export. For official monorepo packages this is verified against `src/index.ts`; for vendor-official packages, read the adapter MDX examples.
- Prefer runtime adapter keys for slugs when they differ from product names. Google Chat uses `gchat` because the adapter name and webhook path are `gchat`.
- For official adapters, derive peer dependencies from each package's `package.json` dependencies, excluding `workspace:*`, `chat`, and `@chat-adapter/shared`. Entries with an `importPath` also list the package's optional `peerDependencies`, because the subpath is what imports them (for example, `xchat` from `@chat-adapter/x/chat`).
- For vendor-official adapters, read the corresponding MDX file in `apps/docs/content/adapters/vendor-official/` and update env vars, credential modes, peer deps, and constructor-only config from that source. Keep peer deps that the MDX install command tells users to install, including `@chat-adapter/shared` when applicable.
- Pin `readme` URLs for vendor-official and community adapters to a commit SHA or tag.
- Update the public docs at `apps/docs/content/docs/adapter-catalog.mdx` when the public API or entry shape changes.
- Preserve the API that `chat/adapters` re-exports: `ADAPTERS`, `ADAPTER_NAMES`, `AdapterSlug`, `CatalogAdapter`, `AdapterEnvSpec`, `EnvGroup`, `EnvVar`, `getAdapter`, `isAdapterSlug`, `listPlatformAdapters`, `listStateAdapters`, `listEnvVars`, and `getSecretEnvVars`. Its `ADAPTERS` is an alphabetically keyed copy of the catalog's, and its `CatalogAdapter` makes `features` and `readme` optional, so code written against the original subpath keeps working.
- Use readonly arrays and literal-friendly data (`as const satisfies CatalogAdapter`). Keep `AdapterSlug` derived from `keyof typeof ADAPTERS`; `create-chat-sdk` relies on it for its exhaustive scaffold spec.

## Usage examples

List adapters with a capability:

```typescript
import { getFeatureSupport, listAdapters } from "@chat-adapter/catalog";

const streaming = listAdapters({ type: "platform" }).filter(
  (adapter) => getFeatureSupport(adapter, "streaming").status === "yes"
);
```

Build a setup checklist for secret environment variables:

```typescript
import { getSecretEnvVars } from "@chat-adapter/catalog";

const requiredSecrets = getSecretEnvVars("slack").map((envVar) => envVar.key);
```

## Tests

After catalog changes, run:

```bash
pnpm --filter @chat-adapter/catalog test
pnpm --filter @chat-adapter/catalog build
pnpm --filter @chat-adapter/integration-tests test -- src/docs-adapters.test.ts
pnpm --filter create-chat-sdk test
```

Run `pnpm validate` before declaring broader catalog or export-map work complete.
