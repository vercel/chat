# @chat-adapter/discord

## 4.34.0

### Minor Changes

- 0fdb902: Add opt-in Discord Components v2 rendering for Chat SDK cards via `contentFormat: DiscordContentFormat.ComponentsV2`.
- 5341f90: Ignore `@everyone`/`@here` pings by default in gateway mode. Previously the legacy gateway listener treated global pings as bot mentions, so the bot responded to announcements. A new `respondToGlobalMentions` config option (default `false`) restores the old behavior when enabled, and also lets forwarded gateway messages opt in via the `mention_everyone` field.
- 6c2a391: Add support for renaming native Discord thread channels.

### Patch Changes

- Updated dependencies [5c926f1]
- Updated dependencies [2531a42]
- Updated dependencies [1721fa0]
- Updated dependencies [4717a38]
- Updated dependencies [6714efc]
  - chat@4.34.0
  - @chat-adapter/shared@4.34.0

## 4.33.0

### Patch Changes

- d4c52ca: use the shared `replaceBareMentions` scanner for `@mention` conversion so email addresses, `@handles` inside URLs, and mentions inside code spans are no longer mangled into Discord mentions, and already-formatted `<@id>` tokens are not double-wrapped
- 6de4572: Implement `rehydrateAttachment` on the Discord adapter. Serialization strips an attachment's `fetchData` closure (queue/debounce strategies), and consumers rebuild it via `adapter.rehydrateAttachment`. The Discord adapter did not implement the method, so downstream consumers could not download inbound Discord attachments after deserialization. The Discord CDN `url` survives serialization, so `fetchData` is now rebuilt to fetch that url (preserving its signed query params), matching how the other adapters implement the method.
- Updated dependencies [3abdc69]
- Updated dependencies [0b63791]
- Updated dependencies [0c761f1]
- Updated dependencies [ef2542c]
- Updated dependencies [24a04d5]
- Updated dependencies [d4c52ca]
- Updated dependencies [076fe5d]
  - chat@4.33.0
  - @chat-adapter/shared@4.33.0

## 4.32.0

### Minor Changes

- 022a502: Add a Discord adapter interactionFlags callback for ephemeral slash command responses.

### Patch Changes

- 0d4e3ee: fix: render bare URLs and autolinks as bare URLs instead of `[url](url)` masked links, which Discord only renders inside embeds (in normal messages they showed up as literal text)
- 490fa00: fix bare-mention conversion so it no longer mangles surrounding text: email addresses and `word@word` handles are left intact (the `@` must be at a word boundary), already-formatted mentions like `<@123>` are no longer double-wrapped into `<<@123>>`, and a real mention that follows a period (e.g. `docs.@everyone`) still converts
- Updated dependencies [eccc6b9]
- Updated dependencies [438f551]
- Updated dependencies [d034b8b]
- Updated dependencies [06af3e1]
- Updated dependencies [2e47351]
- Updated dependencies [efa9610]
  - chat@4.32.0
  - @chat-adapter/shared@4.32.0

## 4.31.0

### Patch Changes

- Updated dependencies [778ae69]
- Updated dependencies [171657a]
  - chat@4.31.0
  - @chat-adapter/shared@4.31.0

## 4.30.0

### Patch Changes

- 9b8d8c4: expand npm `keywords` for adapter and state packages to improve discoverability (adds `chat-sdk`, `chatbot`, `ai-agent`, `ai-sdk`, `vercel`, plus platform-specific terms)
- Updated dependencies [5461ea9]
  - chat@4.30.0
  - @chat-adapter/shared@4.30.0

## 4.29.0

### Minor Changes

- 2ffed48: Adapter internals are now `protected` rather than `private`, so consumers can subclass an adapter to override or extend its behavior (e.g. handling additional Telegram update types by overriding `processUpdate`).

### Patch Changes

- e60bc8c: chore: set supported Node versions in engines
- b9b17cd: handle slash commands and button interactions in Discord gateway-only mode
- Updated dependencies [ac8a207]
- Updated dependencies [e60bc8c]
- Updated dependencies [add2730]
- Updated dependencies [b75eedb]
  - chat@4.29.0
  - @chat-adapter/shared@4.29.0

## 4.28.1

### Patch Changes

- Updated dependencies [0cc3d06]
  - chat@4.28.1
  - @chat-adapter/shared@4.28.1

## 4.28.0

### Patch Changes

- c1cd9b5: Add `callbackUrl` to `Button` and `Modal`. When a button is clicked or a modal is submitted, the SDK POSTs the action payload to `callbackUrl` in addition to firing any registered `onAction` / `onModalSubmit` handler. This pairs naturally with webhook-based workflow engines for awaitable button/modal flows.

  Supported platforms: Slack, Teams, Google Chat, WhatsApp, Telegram, and Discord.

- Updated dependencies [eb5f94a]
- Updated dependencies [c1cd9b5]
- Updated dependencies [9824d33]
- Updated dependencies [46d183b]
- Updated dependencies [46d183b]
- Updated dependencies [3490a8c]
  - chat@4.28.0
  - @chat-adapter/shared@4.28.0

## 4.27.0

### Minor Changes

- 6b17c60: Add `apiUrl` config option for custom API endpoint configuration (e.g. GovSlack, GitHub Enterprise, GCC-High Teams)
- a520797: Add `chat.getUser()` method and `UserInfo` type for cross-platform user lookups. Implement `getUser` on Slack, Discord, Google Chat, GitHub, Linear, and Telegram adapters.

### Patch Changes

- 7e5b447: Fix duplicate content display when sending card messages on Discord
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
- 09f6230: Fix silent thread creation failure when Discord returns error code 160004 ("A thread has already been created for this message"). The adapter now recovers by reusing the existing thread instead of falling back to a standalone channel message.
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
