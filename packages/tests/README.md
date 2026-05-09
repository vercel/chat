# @chat-adapter/tests

[![npm version](https://img.shields.io/npm/v/@chat-adapter/tests)](https://www.npmjs.com/package/@chat-adapter/tests)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/tests)](https://www.npmjs.com/package/@chat-adapter/tests)

Vitest factories, matchers, and setup utilities for testing [Chat SDK](https://chat-sdk.dev) adapters and bots.

## Installation

```bash
pnpm add -D @chat-adapter/tests
```

This package has `chat` and `vitest` as peer dependencies — they should already be in your project.

## Factories

```typescript
import {
  createMockAdapter,
  createMockChatInstance,
  createMockState,
  createTestMessage,
  mockLogger,
} from "@chat-adapter/tests";
```

### `createMockAdapter(name?, overrides?)`

Returns an `Adapter` with every method as `vi.fn()` and sensible defaults. Pass `overrides` to swap individual methods:

```typescript
const adapter = createMockAdapter("slack", {
  postMessage: vi.fn().mockResolvedValue({ id: "msg-7", raw: {} }),
});
```

### `createMockState()`

Returns a `StateAdapter` backed by in-memory `Map`s — subscriptions, locks, KV, lists, and queues all work end-to-end. Includes a `cache: Map<string, unknown>` for direct inspection.

### `createMockChatInstance(options?)`

Returns a `ChatInstance` with every `process*` handler as `vi.fn()`. Useful for adapter authors verifying their adapter dispatches incoming events through the right hook.

```typescript
const state = createMockState();
const chat = createMockChatInstance({ state });
await myAdapter.handleWebhook(req); // your adapter under test
expect(chat.processMessage).toHaveBeenCalledOnce();
```

### `createTestMessage(id, text, overrides?)`

Builds a `Message` with parsed markdown AST already wired up.

### `mockLogger` / `createMockLogger()`

`mockLogger` is a shared `Logger` for tests that don't care about isolation. `createMockLogger()` returns a fresh one per call.

## Matchers

Vitest custom matchers covering the most common Chat SDK assertions.

### Auto-register via setup file

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["@chat-adapter/tests/setup"],
  },
});
```

### Manual registration

```typescript
import { matchers } from "@chat-adapter/tests/matchers";
expect.extend(matchers);
```

### Available matchers

| Matcher | Asserts |
|---------|---------|
| `expect(adapter).toHavePosted(threadId, textPattern?)` | `adapter.postMessage` was called for this thread (and message text matches `textPattern` if given) |
| `expect(chat).toHaveDispatched(handler)` | The named `process*` handler on the mock `ChatInstance` was called |
| `expect(state).toBeSubscribedTo(threadId)` | `state.isSubscribed(threadId)` resolves to `true` (async — needs `await`) |

```typescript
expect(adapter).toHavePosted("slack:C1:t1", /hello/);
expect(chat).toHaveDispatched("processMessage");
await expect(state).toBeSubscribedTo("slack:C1:t1");
```

## Audience

- **Bot authors** — drive simulated events through your handlers, assert on outbound calls.
- **Adapter authors** — verify your `Adapter` implementation routes webhooks through the right `ChatInstance.process*` hook with the right normalized payload.

Adapter-specific helpers (e.g. signed Slack webhook builders, Teams claim builders) live in each adapter's own `/testing` subpath, not in this kit.
