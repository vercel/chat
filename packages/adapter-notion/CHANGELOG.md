# @chat-adapter/notion

## 4.38.0

### Minor Changes

- 06b04ac: Add outbound-only Vercel Connect authentication for Notion while retaining native webhook verification and scaffolding.

### Patch Changes

- Updated dependencies [0f24cc3]
- Updated dependencies [bdeb2bf]
- Updated dependencies [a0cba02]
- Updated dependencies [83ede7e]
- Updated dependencies [18d4a23]
  - chat@4.38.0
  - @chat-adapter/shared@4.38.0

## 4.37.0

### Minor Changes

- 0ec6a73: Add `@chat-adapter/notion` for Notion page and block comment discussions: webhook HMAC verification, Post+Edit streaming, conversation history, `message.subject` page metadata, plain-text `@userName`/`@botUserId` mention detection, and File Uploads (up to 3 native attachments). Registers the adapter in the `chat/adapters` catalog and `create-chat-sdk` CLI scaffold, and adds Notion emoji platform support.

### Patch Changes

- Updated dependencies [2a2b2c5]
- Updated dependencies [4ac0455]
- Updated dependencies [0ec6a73]
- Updated dependencies [85e3d22]
  - chat@4.37.0
  - @chat-adapter/shared@4.37.0
