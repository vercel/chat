# @chat-adapter/tests

## 4.29.0

### Patch Changes

- 0adf3ad: Add `@chat-adapter/tests` — Vitest factories, matchers, and setup utilities for Chat SDK adapter and bot authors.

  - **Factories**: `createMockAdapter`, `createMockChatInstance`, `createMockState` (with working in-memory subscriptions/locks/KV/queues), `createTestMessage`, `mockLogger`/`createMockLogger`.
  - **Matchers**: `toHavePosted(threadId, textPattern?)`, `toHaveDispatched(handler)`, `toBeSubscribedTo(threadId)`.
  - **Setup file**: `@chat-adapter/tests/setup` registers all matchers via `expect.extend` — drop into `vitest.config.ts` `setupFiles`.

  `chat` and `vitest` are peer dependencies. Adapter-specific helpers (e.g. signed Slack webhook builders) belong in each adapter's own `/testing` subpath, not in this kit.
