# @chat-adapter/gchat

## 4.28.0

### Minor Changes

- 9824d33: Security fixes for HIGH-severity findings:

  - **adapter-slack**: Replace timing-unsafe `!==` with `crypto.timingSafeEqual` when validating the `x-slack-socket-token` header on forwarded socket-mode events.
  - **adapter-github**: In multi-tenant App mode, eagerly auto-detect the bot user ID on the first installation client / first webhook so `isMe` checks work and self-reply loops are prevented. Falls back to `apps.getAuthenticated` + `users.getByUsername` when `users.getAuthenticated` is unavailable for installation tokens.
  - **adapter-linear**: Add optional `encryptionKey` config (or `LINEAR_ENCRYPTION_KEY` env var) that AES-256-GCM-encrypts `accessToken` and `refreshToken` at rest in the state store. Tolerates plaintext records for zero-downtime rollout.
  - **adapter-gchat**: Fail-closed by default — the constructor now throws `ValidationError` if neither `googleChatProjectNumber` nor `pubsubAudience` is configured. To accept unverified webhooks (development only), set the new `disableSignatureVerification: true` flag (or `GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION=true`). Mirrors the Slack adapter's signing-secret requirement.
  - **adapter-shared**: New `decodeKey` / `encryptToken` / `decryptToken` / `isEncryptedTokenData` utilities (AES-256-GCM, hex or base64 32-byte keys), shared by Slack and Linear.

### Patch Changes

- Updated dependencies [9824d33]
- Updated dependencies [46d183b]
- Updated dependencies [46d183b]
- Updated dependencies [3490a8c]
  - @chat-adapter/shared@4.28.0
  - chat@4.28.0

## 4.27.0

### Minor Changes

- 6b17c60: Add `apiUrl` config option for custom API endpoint configuration (e.g. GovSlack, GitHub Enterprise, GCC-High Teams)
- a520797: Add `chat.getUser()` method and `UserInfo` type for cross-platform user lookups. Implement `getUser` on Slack, Discord, Google Chat, GitHub, Linear, and Telegram adapters.

### Patch Changes

- 1e7c551: restore attachment fetchData after queue/debounce serialization
- 53ee151: Clear cardsV2 when editing a message to plain text so old cards don't persist underneath the new text
- 1c12d33: Support `Select` and `RadioSelect` card actions in Google Chat by rendering them as `selectionInput` widgets and reading selected values from form inputs on action events.
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

- 4cc87dd: Preserve custom link labels in Google Chat text messages by rendering Markdown links with Google Chat's supported `<url|text>` syntax.
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

- 000792b: Introduce optional gchat signature verification
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
- 32b17d9: refactor: replace broad googleapis dependency with specific packages
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

- 09cdfa3: fix(slack,gchat): convert **bold** to _bold_ in Card text blocks

  CardText content with standard Markdown bold was rendering literally in Slack and Google Chat. Both platforms use single asterisk for bold. Added markdownToMrkdwn conversion in convertTextToBlock and field converters.

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

### Minor Changes

- efa6b36: add postEphemeral() for ephemeral messages

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

- d80ea3f: Refactor
- Updated dependencies [498eb04]
- Updated dependencies [d80ea3f]
  - @chat-adapter/shared@4.3.0
  - chat@4.3.0

## 4.2.0

### Minor Changes

- 0b5197a: Fixed and tested fetchMessages and allMessages

### Patch Changes

- Updated dependencies [0b5197a]
  - chat@4.2.0

## 4.1.0

### Minor Changes

- 9b95317: Native streaming support

### Patch Changes

- Updated dependencies [9b95317]
  - chat@4.1.0

## 4.0.2

### Patch Changes

- c72b37a: Fix gchat actions
  - chat@4.0.2

## 4.0.1

### Patch Changes

- b27ea10: READMEs
- Updated dependencies [b27ea10]
  - chat@4.0.1
