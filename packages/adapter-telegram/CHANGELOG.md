# @chat-adapter/telegram

## 4.27.0

### Minor Changes

- 6b17c60: Add `apiUrl` config option for custom API endpoint configuration (e.g. GovSlack, GitHub Enterprise, GCC-High Teams)
- a520797: Add `chat.getUser()` method and `UserInfo` type for cross-platform user lookups. Implement `getUser` on Slack, Discord, Google Chat, GitHub, Linear, and Telegram adapters.

### Patch Changes

- 1e7c551: restore attachment fetchData after queue/debounce serialization
- b9a1961: Switch Telegram adapter's outbound `parse_mode` from legacy `Markdown` to `MarkdownV2`, and replace the standard-markdown passthrough renderer with a proper AST → MarkdownV2 renderer. Standard markdown (`**bold**`) and legacy `Markdown` (`*bold*`) use different syntaxes and have no shared escape rules, so any message containing `.`, `!`, `(`, `)`, `-`, `_` in regular text — which is virtually every LLM-generated message — was being rejected with `can't parse entities`. The new renderer walks the mdast tree and emits MarkdownV2 with context-aware escaping (normal text vs. code blocks vs. link URLs), uniformly applies MarkdownV2 `parse_mode` to every format-converter output (including AST messages, which previously shipped without `parse_mode` and rendered asterisks literally), and escapes card fallback text.

  Also fix silent message truncation that the MarkdownV2 migration widened from a rare bug into a reliable 400. The previous truncator sliced messages at 4096/1024 chars and appended literal `...`, but in MarkdownV2 `.` is a reserved character that must be escaped, the slice can leave an orphan trailing `\`, and it can cut through a paired entity (`*bold*`, `` `code` ``) leaving it unclosed — all of which cause `can't parse entities`. The two truncate methods are unified into `truncateForTelegram(text, limit, parseMode)`, which appends an escaped `\.\.\.` for MarkdownV2 and walks back past unbalanced entity delimiters or orphan backslashes before appending. Plain-text messages keep literal `...`.

  Internal typing hardening: `renderMarkdownV2` is now typed exhaustively on mdast's `Nodes` union with a `never` assertion, so new mdast node types fail the build rather than silently falling through. Introduce `TelegramParseMode = "MarkdownV2" | "plain"` replacing the previous `string | undefined` at call sites, with `toBotApiParseMode` mapping to the Bot API wire format at the boundary. The `chat` package gains a re-export of mdast's `Nodes` union so adapters can build exhaustively typed renderers without importing mdast directly.

- Updated dependencies [8a0c7b3]
- Updated dependencies [1e7c551]
- Updated dependencies [b0ab804]
- Updated dependencies [d630e6c]
- Updated dependencies [b9a1961]
- Updated dependencies [a520797]
- Updated dependencies [70281dc]
- Updated dependencies [9093292]
- Updated dependencies [7e90d9c]
- Updated dependencies [bca4792]
- Updated dependencies [37dbb4a]
- Updated dependencies [608d5f0]
- Updated dependencies [a179b29]
- Updated dependencies [a8f2aab]
  - chat@4.27.0
  - @chat-adapter/shared@4.27.0

## 4.26.0

### Patch Changes

- Updated dependencies [2235c16]
- Updated dependencies [ddb084b]
  - chat@4.26.0
  - @chat-adapter/shared@4.26.0

## 4.25.0

### Patch Changes

- Updated dependencies [2700ce8]
  - chat@4.25.0
  - @chat-adapter/shared@4.25.0

## 4.24.0

### Patch Changes

- 8d89274: fix: disable source maps in published packages
- Updated dependencies [8d89274]
- Updated dependencies [4f5d200]
- Updated dependencies [27b34e1]
  - @chat-adapter/shared@4.24.0
  - chat@4.24.0

## 4.23.0

### Patch Changes

- Updated dependencies [4166e09]
  - chat@4.23.0
  - @chat-adapter/shared@4.23.0

## 4.22.0

### Patch Changes

- Updated dependencies [f2d8957]
  - chat@4.22.0
  - @chat-adapter/shared@4.22.0

## 4.21.0

### Minor Changes

- d778f72: Switch adapters from optional dep to full dep on chat

### Patch Changes

- 1d36004: Set `parse_mode` to `"Markdown"` when posting messages with a `markdown` field, not only for card messages
- 85a1d7f: Convert Telegram message entities to markdown in parsed messages
- Updated dependencies [e45a67f]
- Updated dependencies [13ba1c7]
- Updated dependencies [95fd8ce]
  - chat@4.21.0
  - @chat-adapter/shared@4.21.0

## 4.20.2

### Patch Changes

- chat@4.20.2
- @chat-adapter/shared@4.20.2

## 4.20.1

### Patch Changes

- Updated dependencies [e206371]
- Updated dependencies [8d88b8c]
  - chat@4.20.1
  - @chat-adapter/shared@4.20.1

## 4.20.0

### Patch Changes

- ee1c025: Fix DM replies failing with "chat not found" due to double-prefixed channel ID in postChannelMessage
  - chat@4.20.0
  - @chat-adapter/shared@4.20.0

## 4.19.0

### Patch Changes

- Updated dependencies [eb49b2a]
- Updated dependencies [5b41f08]
- Updated dependencies [c4b0e69]
  - chat@4.19.0
  - @chat-adapter/shared@4.19.0

## 4.18.0

### Patch Changes

- Updated dependencies [a3cfc1a]
  - chat@4.18.0
  - @chat-adapter/shared@4.18.0

## 4.17.0

### Patch Changes

- Updated dependencies [cc65dc3]
  - chat@4.17.0
  - @chat-adapter/shared@4.17.0

## 4.16.1

### Patch Changes

- Updated dependencies [130e780]
- Updated dependencies [ff954f9]
- Updated dependencies [f27c89b]
  - chat@4.16.1
  - @chat-adapter/shared@4.16.1

## 4.16.0

### Minor Changes

- 02e7ef6: Implements table markdown rendering, and fully streaming markdown rendering including for Slack which has native streaming. Overhauls adapters to have better fallback-render behavior

### Patch Changes

- 24532a7: Add Telegram adapter runtime modes (`auto`, `webhook`, `polling`) with safer auto fallback behavior, expose `adapter.resetWebhook(...)` and `adapter.runtimeMode`, switch polling config to `longPolling`, and fix initialization when the chat username is missing.
- Updated dependencies [02e7ef6]
- Updated dependencies [9522b04]
- Updated dependencies [f5a75c9]
- Updated dependencies [f0c7050]
- Updated dependencies [73de82d]
  - @chat-adapter/shared@4.16.0
  - chat@4.16.0

## 4.15.0

### Minor Changes

- 0c688a0: Add a new Telegram adapter package with webhook handling, message send/edit/delete, reactions, typing indicators, DM support, and cached fetch APIs.

### Patch Changes

- Updated dependencies [0f85031]
- Updated dependencies [5b3090a]
  - chat@4.15.0
  - @chat-adapter/shared@4.15.0

## 4.13.4

### Minor Changes

- Initial Telegram adapter release.

### Patch Changes

- chat@4.13.4
- @chat-adapter/shared@4.13.4
