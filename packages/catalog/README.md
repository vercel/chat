# @chat-adapter/catalog

> npm package: [`@chat-adapter/catalog`](https://www.npmjs.com/package/@chat-adapter/catalog)

[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Static catalog of [Chat SDK](https://chat-sdk.dev) adapters: every official, vendor-official, and community adapter listed on [chat-sdk.dev/adapters](https://chat-sdk.dev/adapters), with its npm package, maintainer, and supported capabilities. Official and vendor-official entries also include the factory export, peer dependencies, and environment variables needed to set them up.

The package has no dependencies and imports no adapter code, so you can use it in websites, build scripts, setup screens, and CLIs. chat-sdk.dev and [`create-chat-sdk`](https://chat-sdk.dev/docs/create-chat-sdk) both read from it.

Documentation: [chat-sdk.dev/docs/adapter-catalog](https://chat-sdk.dev/docs/adapter-catalog) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/catalog
```

## Usage

List adapters and check their capabilities:

```typescript
import { getFeatureSupport, listAdapters } from "@chat-adapter/catalog";

for (const adapter of listAdapters({ type: "platform" })) {
  const streaming = getFeatureSupport(adapter, "streaming");
  console.log(adapter.name, adapter.group, adapter.packageName, streaming);
}
```

`listAdapters()` returns official and vendor-official adapters in the order chat-sdk.dev lists them, followed by community adapters. Pass `group` (one group or an array) or `type` to filter.

Read setup requirements for an official or vendor-official adapter:

```typescript
import { getAdapter, getSecretEnvVars, listEnvVars } from "@chat-adapter/catalog";

const slack = getAdapter("slack");
console.log(slack.packageName, slack.factoryExport, slack.peerDeps);

const allVars = listEnvVars("slack").map((envVar) => envVar.key);
const secrets = getSecretEnvVars("slack").map((envVar) => envVar.key);
```

## API

| Export | Description |
| --- | --- |
| `listAdapters(options?)` | Every entry, including community adapters, filtered by `group` and `type` |
| `getCatalogEntry(slug)` | Any entry by slug, or `undefined` |
| `getAdapter(slug)` | An official or vendor-official entry by slug, or `undefined` |
| `isAdapterSlug(slug)` | Narrows a string to `AdapterSlug` (official and vendor-official) |
| `listPlatformAdapters()` / `listStateAdapters()` | Official and vendor-official entries sorted by slug |
| `getFeatureSupport(adapterOrSlug, key)` | `{ status, label? }` for one capability; undeclared capabilities return `{ status: "no" }` |
| `getFeatureCategories(type)` | Capability keys and labels grouped for display |
| `listEnvVars(slug)` / `getSecretEnvVars(slug)` | Flattened, de-duplicated env vars; empty for community adapters |
| `ADAPTERS` / `COMMUNITY_ADAPTERS` | Entries keyed by slug |
| `ADAPTER_NAMES` | Official and vendor-official slugs, sorted |
| `PLATFORM_FEATURE_CATEGORIES` / `STATE_FEATURE_CATEGORIES` | Every capability key with its display label |

The `chat/adapters` subpath of the `chat` package is a deprecated re-export of the official and vendor-official API in this package.

## Adding an adapter

Each adapter is one file in `src/adapters/<group>/<slug>.ts`, registered in `src/adapters/index.ts`, with a docs page in `apps/docs/content/adapters/<group>/`. See [Publishing your adapter](https://chat-sdk.dev/docs/contributing/publishing#listing-on-chat-sdkdev) for community listings and [List a vendor-official adapter](https://chat-sdk.dev/docs/contributing/vendor-official) for vendor-official listings.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
