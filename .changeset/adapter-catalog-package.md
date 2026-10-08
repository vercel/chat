---
"@chat-adapter/catalog": minor
"chat": minor
"create-chat-sdk": patch
---

Add `@chat-adapter/catalog`, a zero-dependency catalog of every adapter on chat-sdk.dev. It lists official, vendor-official, and community adapters with their npm package, maintainer, README, and capability support, plus the factory export, peer dependencies, and environment variables for official and vendor-official adapters. New helpers include `listAdapters()`, `getCatalogEntry()`, and `getFeatureSupport()`.

The `chat/adapters` subpath is now deprecated. It re-exports the original API from `@chat-adapter/catalog`, so existing imports keep working. `CatalogAdapter` now also includes `features` and `readme`. `create-chat-sdk` reads adapter metadata from `@chat-adapter/catalog`.

`getAdapter()` and `listEnvVars()` now return `undefined` and `[]` for inherited object keys such as `"toString"`, instead of returning `Object.prototype` members.
