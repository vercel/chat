# @chat-adapter/notion

## 4.41.0

### Patch Changes

- fcdc1c9: Honor an adapter's definitive `isMention: false` instead of re-detecting mentions from the message text.
  
  An adapter that reads structured platform content reports `true` or `false`, and the SDK falls back to matching `@username` in the text only when the adapter reports nothing. A definitive `false` now wins, so an adapter can suppress a mention that exists only in text its platform renders literally, such as a code sample. Adapters that previously returned `false` to mean "not detected" should return `undefined` instead. Direct messages are unchanged: with no `onDirectMessage` handler registered they still route to `onNewMention`.
  
  Adapter changes that follow from the new contract:
  
  - Linear: ordinary comments are left undetermined, so SDK text detection still applies to them.
  - Notion: `keyword` mode leaves comments without a keyword match undetermined instead of reporting `false`, so `@userName` in the text still counts.
  - X: posts rebuilt from raw or fetched by id are left undetermined instead of reporting `false`. Only `post.mention.create` events report `true`.
  - Discord: a real ping, role mention, `@everyone`, or allowlisted channel reports `true`; anything else is left undetermined instead of `false`, so a literal `@botname` typed in the text still counts as before.
- Updated dependencies [f233ffe]
- Updated dependencies [6adca36]
- Updated dependencies [ad90432]
- Updated dependencies [683eadc]
- Updated dependencies [dc2a777]
- Updated dependencies [139d337]
- Updated dependencies [2e2426d]
- Updated dependencies [8421953]
- Updated dependencies [91683e5]
- Updated dependencies [056d883]
- Updated dependencies [c21ccbc]
- Updated dependencies [fcdc1c9]
  - chat@4.41.0
  - @chat-adapter/shared@4.41.0

## 4.40.0

### Patch Changes

- Updated dependencies [f485255]
- Updated dependencies [b7c9316]
- Updated dependencies [4a0b5c0]
  - chat@4.40.0
  - @chat-adapter/shared@4.40.0

## 4.39.0

### Patch Changes

- Updated dependencies [2ce2be0]
- Updated dependencies [153bd96]
- Updated dependencies [16ea171]
- Updated dependencies [169788b]
- Updated dependencies [eddcd7e]
- Updated dependencies [bb92688]
- Updated dependencies [5b538f6]
- Updated dependencies [e71bfea]
- Updated dependencies [929878b]
- Updated dependencies [500b7e6]
- Updated dependencies [b6fa24c]
  - chat@4.39.0
  - @chat-adapter/shared@4.39.0

## 4.38.1

### Patch Changes

- Updated dependencies [6cb933e]
- Updated dependencies [764e475]
  - chat@4.38.1
  - @chat-adapter/shared@4.38.1

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
