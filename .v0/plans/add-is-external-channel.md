# Add `isExternalChannel` support to chat SDK

## Background

Slack sends `is_ext_shared_channel: boolean` on event callback payloads. When the bot is in an external/shared channel (Slack Connect), it may be leaking internal context (repo summaries, etc.) to outsiders. We need to surface this at the `Thread` level so consumers can gate behavior.

## API Design Decision: `isExternalChannel` (boolean) vs `visibility` (enum)

**Recommendation: `isExternalChannel: boolean`**

Reasons:
- **Matches the source data**: Slack (the only platform with this concept today) sends a simple `is_ext_shared_channel` boolean. No need to over-abstract.
- **Follows the `isDM` pattern**: The codebase already uses `isDM: boolean` on Thread/Postable with the exact same architecture (adapter method -> Chat.createThread -> ThreadImpl property). Adding `isExternalChannel` is perfectly consistent.
- **Discord has no equivalent**: Discord doesn't support cross-server channel sharing at all.
- **Teams**: Teams has "shared channels" (`membershipType: "shared"`) but that's a different Teams-specific concept. It could map to `isExternalChannel = true` in the future.
- **Google Chat**: GChat has external spaces but it's not exposed in webhook payloads -- would need a separate API call. Can be added later.
- **GitHub/Linear**: No concept of external channels.
- A `visibility` enum (`"private" | "external" | "public"`) conflates two orthogonal concerns -- DM/private vs external. A channel can be both public within a workspace AND externally shared. Keeping them separate (`isDM` + `isExternalChannel`) is cleaner.

## Implementation Plan

### 1. Core types (`packages/chat/src/types.ts`)

- Add `isExternalChannel?(threadId: string): boolean` to the `Adapter` interface (optional, like `isDM?`)
- Add `readonly isExternalChannel: boolean` to the `Postable` interface (alongside `isDM`)
- Add `isExternalChannel?: boolean` to `ThreadInfo` interface
- Add `isExternalChannel?: boolean` to `ChannelInfo` interface

### 2. Thread implementation (`packages/chat/src/thread.ts`)

- Add `isExternalChannel?: boolean` to `SerializedThread`
- Add `isExternalChannel?: boolean` to both `ThreadImplConfigWithAdapter` and `ThreadImplConfigLazy`
- Add `readonly isExternalChannel: boolean` property to `ThreadImpl` class
- Set it in constructor: `this.isExternalChannel = config.isExternalChannel ?? false`
- Include it in `toJSON()` and `fromJSON()` serialization

### 3. Channel implementation (`packages/chat/src/channel.ts`)

- Add `isExternalChannel` to `ChannelImpl` (same pattern as `isDM`)

### 4. Chat class (`packages/chat/src/chat.ts`)

- In `createThread()`, call `adapter.isExternalChannel?.(threadId) ?? false` and pass to ThreadImpl constructor (same pattern as `isDM`)

### 5. Slack adapter (`packages/adapter-slack/src/index.ts`)

- Add `is_ext_shared_channel?: boolean` to the `SlackWebhookPayload` interface
- Cache `is_ext_shared_channel` per channel ID in a `Set<string>` from incoming payloads
- Also read `is_ext_shared` from `conversations.info` API responses in `fetchThread` and `fetchChannelInfo`
- Implement `isExternalChannel(threadId)` that checks the cache

### 6. Other adapters (Discord, Teams, GChat, GitHub, Linear)

- `isExternalChannel` is optional on the `Adapter` interface, so these don't need explicit stubs
- The `Chat.createThread()` fallback (`adapter.isExternalChannel?.(threadId) ?? false`) handles the default

### 7. Mock adapter (`packages/chat/src/mock-adapter.ts`)

- Add `isExternalChannel` mock returning `false` (same pattern as `isDM`)

### 8. Tests

- Serialization round-trip tests for `isExternalChannel` on Thread
- Channel inheritance tests (`thread.channel.isExternalChannel`)
- Backward compatibility test (missing `isExternalChannel` in JSON defaults to `false`)

## Key Files Modified

1. `packages/chat/src/types.ts` - Core interfaces
2. `packages/chat/src/thread.ts` - ThreadImpl
3. `packages/chat/src/channel.ts` - ChannelImpl
4. `packages/chat/src/chat.ts` - Thread creation
5. `packages/chat/src/mock-adapter.ts` - Test mock
6. `packages/adapter-slack/src/index.ts` - Slack implementation (main one)
7. `packages/chat/src/serialization.test.ts` - Serialization tests
8. `packages/chat/src/channel.test.ts` - Channel tests
