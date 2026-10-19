# @chat-adapter/catalog

## 4.43.0

### Minor Changes

- 115cd39: Add `@chat-adapter/gitlab` for merge request and issue comment threads on GitLab.com, GitLab Self-Managed, and GitLab Dedicated. It verifies webhooks with a signing token or secret token, replies inside each comment's discussion, handles emoji reactions, uploads files, and resolves `message.subject` to the parent merge request or issue. Registers the adapter in `@chat-adapter/catalog` and the `create-chat-sdk` CLI scaffold, and adds GitLab emoji platform support.

### Patch Changes

- 9ff2537: List `@microsoft/teams.graph` as a peer dependency of the Teams adapter, which now constructs a Graph client at runtime.
- 228b30d: Add WhatsApp and RCS typing indicators through Twilio's Messaging v3 Indicators API, with a `messagingApiUrl` option to override its base URL. On WhatsApp, Twilio marks the referenced message as read. `TwilioApiError` messages now include the Twilio error code and message when the response body is JSON.
- 2e7e0ef: The Web adapter's server entry no longer depends on the AI SDK at runtime, and a new `protocol` option lets it speak AG-UI (`protocol: "ag-ui"`) for TanStack AI and other AG-UI clients. The default stays `"ai-sdk"`. `ai` is now an optional peer dependency, needed only for the `react`, `vue`, and `svelte` helpers.
  
  `message.raw` is now typed as the new `WebMessage` type instead of the AI SDK `UIMessage`. A `UIMessage` is still assignable to `WebMessage`, but part fields other than `type` are typed `unknown`. If your handler reads typed part fields with the `"ai-sdk"` protocol, cast with `message.raw as UIMessage`.
  
  Request handling is stricter and handles retries:
  
  - The last entry in `messages` must be a user message. Bodies ending in an assistant or tool message, such as client-side tool results, now get a 400 instead of being silently ignored.
  - A conversation id (`id` with `"ai-sdk"`, `threadId` with `"ag-ui"`) that is present but not a string gets a 400 instead of a new conversation.
  - Resending the same user message, as regenerate in `useChat` or reload in TanStack AI does, now runs the handler again instead of being dropped as a duplicate. History keeps the earlier reply and stores the repeated message a second time.
  - A body shaped for the other protocol gets a 400 that names the `protocol` option.

## 4.42.0

### Minor Changes

- daaa0ac: Add `@chat-adapter/catalog`, a zero-dependency catalog of every adapter on chat-sdk.dev. It lists official, vendor-official, and community adapters with their npm package, maintainer, README, and capability support, plus the factory export, peer dependencies, and environment variables for official and vendor-official adapters. New helpers include `listAdapters()`, `getCatalogEntry()`, and `getFeatureSupport()`.
  
  The `chat/adapters` subpath is now deprecated. It re-exports the original API from `@chat-adapter/catalog`, so existing imports keep working. Its `ADAPTERS` keeps alphabetical key order, and its `CatalogAdapter` type accepts objects without the new `features` and `readme` fields. In `@chat-adapter/catalog`, `ADAPTERS` follows chat-sdk.dev listing order and `CatalogAdapter` requires both fields. `create-chat-sdk` reads adapter metadata from `@chat-adapter/catalog`.
  
  `getAdapter()` and `listEnvVars()` now return `undefined` and `[]` for inherited object keys such as `"toString"`, instead of returning `Object.prototype` members.
