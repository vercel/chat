# AGENTS.md - `chat/adapters`

Guidance for coding agents working on the `chat/adapters` catalog subpath.

## Purpose

`index.ts` is a static, zero-dependency catalog for official and vendor-official adapters. It is meant for setup UIs, build scripts, and onboarding flows that need adapter metadata without importing any adapter package or platform SDK.

## Maintenance rules

- Keep the module self-contained. Do not import adapter packages, state packages, docs code, Node APIs, or platform SDKs from `index.ts`.
- Keep catalog metadata in sync with `apps/docs/adapters.json`: `slug`, `name`, `description`, `packageName`, `type`, and `group`.
- For official adapters, derive peer dependencies from each package's `package.json` dependencies, excluding `workspace:*`, `chat`, and `@chat-adapter/shared`.
- For vendor-official adapters, read the corresponding MDX file in `apps/docs/content/adapters/vendor-official/` and update env vars, credential modes, peer deps, and constructor-only config from that source. Keep peer deps that the MDX install command tells users to install, including `@chat-adapter/shared` when applicable.
- Preserve the public API shape in this folder unless intentionally changing the `chat/adapters` contract: `ADAPTERS`, `ADAPTER_NAMES`, `AdapterSlug`, `CatalogAdapter`, `AdapterEnvSpec`, `EnvGroup`, `EnvVar`, `getAdapter`, `isAdapterSlug`, `listEnvVars`, and `getSecretEnvVars`.
- Use readonly arrays and literal-friendly data. Keep `AdapterSlug` derived from `keyof typeof ADAPTERS`.

## Usage examples

List cataloged packages without importing adapter implementations:

```typescript
import { ADAPTER_NAMES, getAdapter } from "chat/adapters";

const packages = ADAPTER_NAMES.map((slug) => getAdapter(slug).packageName);
```

Build a setup checklist for secret environment variables:

```typescript
import { getSecretEnvVars } from "chat/adapters";

const requiredSecrets = getSecretEnvVars("slack").map((envVar) => envVar.key);
```

## Tests

After catalog changes, run:

```bash
pnpm --filter chat test -- src/adapters/index.test.ts
pnpm --filter @chat-adapter/integration-tests test -- src/docs-adapters.test.ts
```

Run `pnpm validate` before declaring broader catalog or export-map work complete.
