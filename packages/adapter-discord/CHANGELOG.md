# @chat-adapter/discord

## 4.18.0

### Patch Changes

- Updated dependencies [a3cfc1a]
  - chat@4.18.0
  - @chat-adapter/shared@4.18.0

## 4.17.0

### Patch Changes

- 5f32506: Use `referenced_message` content when parsing Discord thread starter messages so thread roots preserve the original parent message text and metadata.
- Updated dependencies [cc65dc3]
  - chat@4.17.0
  - @chat-adapter/shared@4.17.0

## 4.16.1

### Patch Changes

- f0dfa4d: Fix nested list rendering in Markdown-to-platform converters

  All adapters (Slack, Discord, Teams, Google Chat) were flattening nested
  lists during `fromAst()` conversion, causing child items to be concatenated
  directly onto the parent item without any indentation or newline separation.

  The `nodeToX()` list handler now accepts a `depth` parameter and uses it to
  produce platform-appropriate indentation (`"  ".repeat(depth)`) for nested
  lists. Each list item's children are processed in order: paragraph content
  is prefixed with the bullet/number at the correct indent level, and nested
  list nodes are rendered recursively at `depth + 1`.

- Updated dependencies [130e780]
- Updated dependencies [ff954f9]
- Updated dependencies [f27c89b]
  - chat@4.16.1
  - @chat-adapter/shared@4.16.1

## 4.16.0

### Minor Changes

- 02e7ef6: Implements table markdown rendering, and fully streaming markdown rendering including for Slack which has native streaming. Overhauls adapters to have better fallback-render behavior

### Patch Changes

- 9522b04: Add `disabled` prop to `Button()` for Google Chat and Discord
- da7e05d: Fix Discord reaction events missing thread context
- f01b92f: Add Discord slash command support by dispatching `InteractionType.ApplicationCommand` events to `chat.processSlashCommand(...)` while still sending an immediate deferred interaction ACK.
- 1a37385: Add `Partials.Channel` to gateway client for DM support
- f6d56ea: Fix Discord thread channel ID for reactions and delete
- Updated dependencies [02e7ef6]
- Updated dependencies [9522b04]
- Updated dependencies [f5a75c9]
- Updated dependencies [f0c7050]
- Updated dependencies [73de82d]
  - @chat-adapter/shared@4.16.0
  - chat@4.16.0

## 4.15.0

### Minor Changes

- 5b3090a: Add CardLink element

### Patch Changes

- Updated dependencies [0f85031]
- Updated dependencies [5b3090a]
  - chat@4.15.0
  - @chat-adapter/shared@4.15.0

## 4.14.0

### Minor Changes

- 90dc325: Add typing indicators for Slack adapter using Slack assistants API

### Patch Changes

- Updated dependencies [90dc325]
  - chat@4.14.0
  - @chat-adapter/shared@4.14.0

## 4.13.4

### Patch Changes

- f266dcf: Automatically load from env vars
- Updated dependencies [716ce2a]
  - chat@4.13.4
  - @chat-adapter/shared@4.13.4

## 4.13.3

### Patch Changes

- Updated dependencies [ce33270]
  - chat@4.13.3
  - @chat-adapter/shared@4.13.3

## 4.13.2

### Patch Changes

- Updated dependencies [7d00feb]
  - chat@4.13.2
  - @chat-adapter/shared@4.13.2

## 4.13.1

### Patch Changes

- chat@4.13.1
- @chat-adapter/shared@4.13.1

## 4.13.0

### Patch Changes

- Updated dependencies [f371c0d]
  - chat@4.13.0
  - @chat-adapter/shared@4.13.0

## 4.12.0

### Patch Changes

- Updated dependencies [8c50252]
  - chat@4.12.0
  - @chat-adapter/shared@4.12.0

## 4.11.0

### Minor Changes

- 417374b: Adding inline Select components and Radio buttons to cards

### Patch Changes

- Updated dependencies [417374b]
  - chat@4.11.0
  - @chat-adapter/shared@4.11.0

## 4.10.1

### Patch Changes

- Updated dependencies [c99b183]
  - chat@4.10.1
  - @chat-adapter/shared@4.10.1

## 4.10.0

### Patch Changes

- Updated dependencies [c7d51cb]
  - chat@4.10.0
  - @chat-adapter/shared@4.10.0

## 4.9.1

### Patch Changes

- Updated dependencies [18ce1d0]
  - @chat-adapter/shared@4.9.1
  - chat@4.9.1

## 4.9.0

### Patch Changes

- chat@4.9.0
- @chat-adapter/shared@4.9.0

## 4.8.0

### Patch Changes

- Updated dependencies [cca9867]
  - chat@4.8.0
  - @chat-adapter/shared@4.8.0

## 4.7.2

### Patch Changes

- chat@4.7.2
- @chat-adapter/shared@4.7.2

## 4.7.1

### Patch Changes

- Updated dependencies [160f1f7]
  - chat@4.7.1
  - @chat-adapter/shared@4.7.1

## 4.7.0

### Patch Changes

- Updated dependencies [a13f43e]
  - chat@4.7.0
  - @chat-adapter/shared@4.7.0

## 4.6.0

### Minor Changes

- 68e3f74: Add <LinkButton> component

### Patch Changes

- Updated dependencies [68e3f74]
  - chat@4.6.0
  - @chat-adapter/shared@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [efa6b36]
  - chat@4.5.0
  - @chat-adapter/shared@4.5.0

## 4.4.1

### Patch Changes

- 9e8f9e7: Serde support
- Updated dependencies [1882732]
- Updated dependencies [b5826c2]
- Updated dependencies [9e8f9e7]
  - chat@4.4.1
  - @chat-adapter/shared@4.4.1

## 4.4.0

### Minor Changes

- 8ca6371: Add support for modals, modal events, text inputs and selectors.

### Patch Changes

- Updated dependencies [8ca6371]
  - chat@4.4.0
  - @chat-adapter/shared@4.4.0

## 4.3.0

### Minor Changes

- 498eb04: Discord support

### Patch Changes

- Updated dependencies [498eb04]
- Updated dependencies [d80ea3f]
  - @chat-adapter/shared@4.3.0
  - chat@4.3.0
