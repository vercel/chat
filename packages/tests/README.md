# @chat-adapter/tests

> npm package: [`@chat-adapter/tests`](https://www.npmjs.com/package/@chat-adapter/tests)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

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
| `expect(adapter).toHaveEdited(threadId, messageId, textPattern?)` | `adapter.editMessage` was called for this message (and text matches `textPattern` if given) |
| `expect(adapter).toHaveDeleted(threadId, messageId)` | `adapter.deleteMessage` was called for this message |
| `expect(adapter).toHaveReactedWith(threadId, messageId, emoji)` | `adapter.addReaction` was called with the emoji (string or `EmojiValue.name`) |
| `expect(adapter).toHaveStartedTyping(threadId)` | `adapter.startTyping` was called for this thread |
| `expect(adapter).toHavePostedToChannel(channelId, textPattern?)` | `adapter.postChannelMessage` was called for this channel |
| `expect(chat).toHaveDispatched(handler)` | The named `process*` handler on the mock `ChatInstance` was called |
| `expect(state).toBeSubscribedTo(threadId)` | `state.isSubscribed(threadId)` resolves to `true` (async — needs `await`) |

```typescript
expect(adapter).toHavePosted("slack:C1:t1", /hello/);
expect(adapter).toHaveEdited("slack:C1:t1", "msg-1", /updated/);
expect(adapter).toHaveDeleted("slack:C1:t1", "msg-1");
expect(adapter).toHaveReactedWith("slack:C1:t1", "msg-1", "thumbsup");
expect(adapter).toHaveStartedTyping("slack:C1:t1");
expect(adapter).toHavePostedToChannel("slack:C1");
expect(chat).toHaveDispatched("processMessage");
await expect(state).toBeSubscribedTo("slack:C1:t1");
```

Text-pattern matchers (`toHavePosted`, `toHaveEdited`, `toHavePostedToChannel`) extract a comparable string from `AdapterPostableMessage` — handling plain strings, `PostableMarkdown.markdown`, `PostableRaw.raw`, and `PostableCard.fallbackText`. AST-shaped messages (`PostableAst`) and cards without `fallbackText` aren't text-matchable; assert without `textPattern` and inspect `mock.calls` directly for deeper checks.

## Audience

- **Bot authors** — drive simulated events through your handlers, assert on outbound calls.
- **Adapter authors** — verify your `Adapter` implementation routes webhooks through the right `ChatInstance.process*` hook with the right normalized payload.

Adapter-specific helpers (e.g. signed Slack webhook builders, Teams claim builders) live in each adapter's own `/testing` subpath, not in this kit.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit — it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
