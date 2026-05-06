# chat

## 4.27.0

### Minor Changes

- 1e7c551: restore attachment fetchData after queue/debounce serialization
- b0ab804: Bundle guide markdown and a templates manifest with the package so AI agents can discover Chat SDK resources without fetching at runtime. Guides are written to `resources/guides/*.md` and templates to `resources/templates.json` by the root-level `pnpm sync-resources` script.
- b9a1961: Switch Telegram adapter's outbound `parse_mode` from legacy `Markdown` to `MarkdownV2`, and replace the standard-markdown passthrough renderer with a proper AST → MarkdownV2 renderer. Standard markdown (`**bold**`) and legacy `Markdown` (`*bold*`) use different syntaxes and have no shared escape rules, so any message containing `.`, `!`, `(`, `)`, `-`, `_` in regular text — which is virtually every LLM-generated message — was being rejected with `can't parse entities`. The new renderer walks the mdast tree and emits MarkdownV2 with context-aware escaping (normal text vs. code blocks vs. link URLs), uniformly applies MarkdownV2 `parse_mode` to every format-converter output (including AST messages, which previously shipped without `parse_mode` and rendered asterisks literally), and escapes card fallback text.

  Also fix silent message truncation that the MarkdownV2 migration widened from a rare bug into a reliable 400. The previous truncator sliced messages at 4096/1024 chars and appended literal `...`, but in MarkdownV2 `.` is a reserved character that must be escaped, the slice can leave an orphan trailing `\`, and it can cut through a paired entity (`*bold*`, `` `code` ``) leaving it unclosed — all of which cause `can't parse entities`. The two truncate methods are unified into `truncateForTelegram(text, limit, parseMode)`, which appends an escaped `\.\.\.` for MarkdownV2 and walks back past unbalanced entity delimiters or orphan backslashes before appending. Plain-text messages keep literal `...`.

  Internal typing hardening: `renderMarkdownV2` is now typed exhaustively on mdast's `Nodes` union with a `never` assertion, so new mdast node types fail the build rather than silently falling through. Introduce `TelegramParseMode = "MarkdownV2" | "plain"` replacing the previous `string | undefined` at call sites, with `toBotApiParseMode` mapping to the Bot API wire format at the boundary. The `chat` package gains a re-export of mdast's `Nodes` union so adapters can build exhaustively typed renderers without importing mdast directly.

- a520797: Add `chat.getUser()` method and `UserInfo` type for cross-platform user lookups. Implement `getUser` on Slack, Discord, Google Chat, GitHub, Linear, and Telegram adapters.
- 70281dc: add initialOption and option_groups support for ExternalSelect
- 9093292: add streaming options to thread.post() with platform-specific namespacing
- 7e90d9c: Add Socket Mode support for environments behind firewalls that can't expose public HTTP endpoints, and add `{ action: "clear" }` modal response to close the entire modal view stack
- bca4792: Allow `task_update` streaming chunks to include optional `details` text for Slack task cards
- 37dbb4a: Add `thread.getParticipants()` to get unique human participants in a thread
- 608d5f0: Add `chat.thread(threadId)` method to create Thread handles outside of webhook contexts
- a179b29: Implement external_select block kit for Slack
- a8f2aab: Allow `plan.updateTask()` to target a specific task by ID via `{ id: taskId }` instead of always updating the last in_progress task

### Patch Changes

- 8a0c7b3: Fix Slack structured streaming when `thread.post(stream)` is called from a handler created by an interactive (`block_actions`) payload.
  The team ID is now resolved from `team.id` in addition to `team_id` / `team`.
- d630e6c: fix(chat): honor `concurrency.maxConcurrent` in the `concurrent` strategy. The cap was documented but never applied, so handlers dispatched unbounded. Also warns when `maxConcurrent` is paired with a non-`concurrent` strategy (previously ignored silently) and throws on `maxConcurrent < 1` to prevent a deadlock.

## 4.26.0

### Minor Changes

- 2235c16: export standalone reviver for workflow-safe deserialization without adapter dependencies

### Patch Changes

- ddb084b: guard fallback streaming against empty post and edit calls

## 4.25.0

### Minor Changes

- 2700ce8: Allow Slack native streaming to send markdown tables without wrapping them in code fences, while preserving the previous append-only table fallback for other consumers.

## 4.24.0

### Minor Changes

- 4f5d200: Add Teams dialog (task module) support with `actionType: "modal"` on buttons and `onOpenModal` webhook hook

### Patch Changes

- 8d89274: fix: disable source maps in published packages
- 27b34e1: Use adapter to parse channel id for `thread.channelId`

## 4.23.0

### Minor Changes

- 4166e09: Add `channelVisibility` enum to distinguish private, workspace, external, and unknown channel scopes. Implements `getChannelVisibility()` on the Adapter interface and Slack adapter, replacing the previous `isExternalChannel` boolean.

## 4.22.0

### Minor Changes

- f2d8957: Implement new concurrency strategies for overlapping messages

## 4.21.0

### Minor Changes

- e45a67f: Add optional `disconnect()` hook to the Adapter interface, called during `chat.shutdown()` for resource cleanup

### Patch Changes

- 13ba1c7: Fix `fromFullStream()` step separator detection for AI SDK v5+: rename `step-finish` event check to `finish-step`
- 95fd8ce: Add missing `toJSON()` method declarations to `Thread` and `Channel` interfaces to match their implementations.

## 4.20.2

## 4.20.1

### Patch Changes

- e206371: new toAiMessages API for history-to-AI-SDK transformation. And introduces LinkPreview object on Message
- 8d88b8c: Fix GitHub adapter streaming: accumulate text and post once instead of using the fallbackStream post+edit loop, which caused 422 errors from empty body edits during TTFT. Also log fallbackStream edit failures via the Logger instead of silently swallowing them.

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
