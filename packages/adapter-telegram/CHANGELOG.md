# @chat-adapter/telegram

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
