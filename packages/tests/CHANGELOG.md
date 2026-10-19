# @chat-adapter/tests

## 4.42.0

### Minor Changes

- 403b6ea: Support Vitest 5. The custom matchers now augment Vitest's `Matchers<R, T>` interface, and the `vitest` peer dependency is now `^5.0.0`. Projects that use `@chat-adapter/tests` must upgrade to Vitest 5.

### Patch Changes

- 10764f9: Tighten the shared contract suites so they fail for the behavior they describe:
  
  - `connectWebhookContract` checks that the verifier receives the exact raw request body, and its `401` cases now require the verifier to have run, so a rejection from another gate no longer counts as a pass. The redundant "constructs with a webhookVerifier" case is removed.
  - `selfMessageContract` fails when a bot-authored message reaches any `process*` handler or `handleIncomingMessage`, not only `dispatchHandler`.
  - `threadIdContract` throws when given no cases, registers "matches pinned encoded strings" only when a case pins an `encoded` value, and names the offending id when the prefix check fails.
  - `toHaveDispatched` accepts `processAgentSessionStopped` and `processAgentSessionTitleChanged`.

## 4.41.1

## 4.41.0

### Minor Changes

- 2e2426d: Add `onInstalled` and `onUninstalled` handlers for installation lifecycle events. The Teams adapter emits them for `installationUpdate` activities, including the `add-upgrade` and `remove-upgrade` actions, with a persistable `channelId` for later proactive messages.
  
  The Teams adapter now sends, edits, deletes, reacts, and types against the service URL encoded in the thread ID instead of the app-wide default, so conversations hosted on regional or sovereign Bot Framework endpoints are reached correctly. An explicit `apiUrl` still pins every call to that endpoint.

## 4.40.0

## 4.39.0

## 4.38.1

## 4.38.0

## 4.37.0

## 4.36.0

## 4.35.0

## 4.34.0

## 4.33.0

### Minor Changes

- e7a396a: Add two shared behavioral test contracts for adapter authors:

  - `threadIdContract` — verifies an adapter's thread-id codec round-trips (`decode(encode(x))`), prefixes ids with the adapter name, matches any pinned encoded strings, and (optionally) distinguishes DM from non-DM threads.
  - `selfMessageContract` — verifies an adapter dispatches inbound messages from other users (to `processMessage` by default) but ignores messages the bot authored itself, so it never replies to itself. Requires the matchers to be registered via `setupFiles: ["@chat-adapter/tests/setup"]`.

- a7fb1bc: Add `connectWebhookContract`, a shared Vitest suite for verifying an adapter's Vercel Connect webhook verification. Given a small per-adapter descriptor (how to build the adapter in Connect mode and craft an inbound webhook), it asserts the behavior every Connect-capable adapter shares: a `webhookVerifier` replaces the native signature/secret check and gates inbound requests — accept (`200`) on a truthy result, reject (`401`) on a thrown error or falsy result — and is invoked with the request and raw body. Connect-capable adapters can opt in with ~10 lines.

## 4.32.0

## 4.31.0

## 4.30.0

## 4.29.0

### Patch Changes

- 0adf3ad: Add `@chat-adapter/tests` — Vitest factories, matchers, and setup utilities for Chat SDK adapter and bot authors.

  - **Factories**: `createMockAdapter`, `createMockChatInstance`, `createMockState` (with working in-memory subscriptions/locks/KV/queues), `createTestMessage`, `mockLogger`/`createMockLogger`.
  - **Matchers**: `toHavePosted(threadId, textPattern?)`, `toHaveDispatched(handler)`, `toBeSubscribedTo(threadId)`.
  - **Setup file**: `@chat-adapter/tests/setup` registers all matchers via `expect.extend` — drop into `vitest.config.ts` `setupFiles`.

  `chat` and `vitest` are peer dependencies. Adapter-specific helpers (e.g. signed Slack webhook builders) belong in each adapter's own `/testing` subpath, not in this kit.
