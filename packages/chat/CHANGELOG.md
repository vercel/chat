# chat

## 4.20.0

## 4.19.0

### Minor Changes

- eb49b2a: Add `forceReleaseLock` to StateAdapter and `onLockConflict` config option for interrupt/steerability of long-running handlers
- 5b41f08: Add `thread.schedule()` and `ScheduledMessage` type for scheduling messages to be sent at a future time. Slack adapter implements scheduling via `chat.scheduleMessage` API with `cancel()` support.
- c4b0e69: Tighten Adapter & StateAdapter interfaces: make `channelIdFromThreadId` required, make `EphemeralMessage` generic over `TRawMessage`, add `satisfies Adapter` to mock adapter, migrate remaining adapters to shared error types

## 4.18.0

### Patch Changes

- a3cfc1a: AI SDK6 compat fixes and support for native slack tables

## 4.17.0

### Patch Changes

- cc65dc3: fix: non-atomic message deduplication causes app_mention events to be silently dropped

## 4.16.1

### Patch Changes

- 130e780: Fix openModal crash when action has no thread context (e.g. home tab buttons)
- ff954f9: Better streaming for AI SDK
- f27c89b: Improve StreamChunk type safety with discriminated union and fix url_verification security bypass

## 4.16.0

### Minor Changes

- 02e7ef6: Implements table markdown rendering, and fully streaming markdown rendering including for Slack which has native streaming. Overhauls adapters to have better fallback-render behavior
- f0c7050: add onMemberJoinedChannel on slack adapter

### Patch Changes

- 9522b04: Add `disabled` prop to `Button()` for Google Chat and Discord
- f5a75c9: Add `fallbackStreamingPlaceholderText` config option to suppress the initial "..." placeholder in post+edit fallback streaming
- 73de82d: Add remend for streaming markdown healing

## 4.15.0

### Minor Changes

- 0f85031: Added configurable dedupeTtlMs option to ChatConfig

  Change default dedupe ttl to 5min

- 5b3090a: Add CardLink element

## 4.14.0

### Minor Changes

- 90dc325: Add typing indicators for Slack adapter using Slack assistants API

## 4.13.4

### Patch Changes

- 716ce2a: Automatically create new ConsoleLogger

## 4.13.3

### Patch Changes

- ce33270: Currently deserialized threads cannot post streams to Slack due to lost metadata

## 4.13.2

### Patch Changes

- 7d00feb: Add docs to package

## 4.13.1

## 4.13.0

### Minor Changes

- f371c0d: feat(slack): full Slack Assistants API support

  - Route `assistant_thread_started` and `assistant_thread_context_changed` events
  - Add `onAssistantThreadStarted` and `onAssistantContextChanged` handler registration
  - Add `setSuggestedPrompts`, `setAssistantStatus`, `setAssistantTitle` methods on Slack adapter
  - Extend `stream()` to accept `stopBlocks` for Block Kit on stream finalization
  - Bump `@slack/web-api` to `^7.11.0` for `chatStream` support
  - Export all new types

## 4.12.0

### Minor Changes

- 8c50252: Adding support for slash commands.

## 4.11.0

### Minor Changes

- 417374b: Adding inline Select components and Radio buttons to cards

## 4.10.1

### Patch Changes

- c99b183: Added support for creating modals from ephemeral messages.

## 4.10.0

### Minor Changes

- c7d51cb: Added support for passing arbitrary metadata through the modal lifecycle via a new privateMetadata field.

## 4.9.1

## 4.9.0

## 4.8.0

### Minor Changes

- cca9867: GitHub + Linear integrations

## 4.7.2

## 4.7.1

### Patch Changes

- 160f1f7: Fetch relatedMessage separately from the event thread.

## 4.7.0

### Minor Changes

- a13f43e: Add relatedThread and relatedMessage to modal events.

## 4.6.0

### Minor Changes

- 68e3f74: Add <LinkButton> component

## 4.5.0

### Minor Changes

- efa6b36: add postEphemeral() for ephemeral messages

## 4.4.1

### Patch Changes

- 1882732: Serde from chat singleton
- b5826c2: Adding private metadata field to `onModalClose` events.
- 9e8f9e7: Serde support

## 4.4.0

### Minor Changes

- 8ca6371: Add support for modals, modal events, text inputs and selectors.

## 4.3.0

### Minor Changes

- 498eb04: Discord support

### Patch Changes

- d80ea3f: Refactor

## 4.2.0

### Minor Changes

- 0b5197a: Fixed and tested fetchMessages and allMessages

## 4.1.0

### Minor Changes

- 9b95317: Native streaming support

## 4.0.2

## 4.0.1

### Patch Changes

- b27ea10: READMEs
