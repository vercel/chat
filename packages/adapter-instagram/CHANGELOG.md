# @chat-adapter/instagram

## 4.44.0

### Patch Changes

- d3dc15a: `parseIncoming()` now skips markdown parsing for more kinds of input that are slow to parse, not just long text. Some messages under the 16,384-character limit took seconds to parse, threw a stack overflow, or produced trees too deep to serialize. Examples include unmatched `*`, `_`, or `~` in one paragraph, runs of `]` or `<`, `www.` repeated within one word, and lines that open hundreds of nested quotes or lists. Before parsing, `parseIncoming()` now also checks for more than 2,048 `*`, `_`, and `~` characters (`maxIncomingEmphasisMarkers`), more than 128 `]` characters (`maxIncomingClosingBrackets`), more than 512 `<` characters (`maxIncomingAngleBrackets`), more than 8 `www.` links in one word (`maxIncomingWwwAutolinks`), and lines nested more than 32 deep (`maxIncomingContainerMarkers`). These checks run in linear time and ignore characters inside fenced code blocks. After parsing, it checks for trees deeper than 128 levels (`maxIncomingAstDepth`), and it also falls back when `toAst()` throws a `RangeError`. When any limit is hit, the text is kept verbatim in a single text node. Converters can override `incomingFallbackText()` to clean up that text, and `exceedsIncomingBudget()` to check text they rewrite before parsing.
  
  The Discord gateway, Instagram, Linear, Messenger, Notion, Slack, Teams history, Telegram, Twilio, Web, WhatsApp, and XChat adapters now build incoming and fetched messages with `parseIncoming()` instead of parsing them without limits, and so does GitHub `listThreads` for pull request titles. These adapters didn't limit inbound length before, so messages over 16,384 characters now also lose markdown structure in `formatted`, while keeping their content in `text`. Deeply nested quotes no longer make these adapters drop the message, return a server error, or fail a whole page of history.
  
  Slack checks the limits once across a message's text, blocks, attachments, and table cells, checks the markdown it converts mrkdwn into, and on fallback decodes entities and renders mentions, channels, and links as parsed messages do. Discord, Google Chat, and WhatsApp check the markdown they convert platform text into. Teams checks the limits on decoded text, renders mentions and entities as plain text on fallback, and no longer backtracks for seconds on malformed links in incoming HTML.
- Updated dependencies [b8b6f0f]
- Updated dependencies [49e6833]
- Updated dependencies [d3dc15a]
- Updated dependencies [6c4457e]
- Updated dependencies [17f6005]
  - chat@4.44.0
  - @chat-adapter/shared@4.44.0

## 4.43.0

### Patch Changes

- Updated dependencies [115cd39]
- Updated dependencies [36325f3]
- Updated dependencies [a32470e]
- Updated dependencies [228b30d]
  - chat@4.43.0
  - @chat-adapter/shared@4.43.0

## 4.42.0

### Patch Changes

- Updated dependencies [2f1cfa2]
- Updated dependencies [daaa0ac]
- Updated dependencies [fd291b8]
- Updated dependencies [19c7aa2]
- Updated dependencies [08081fa]
- Updated dependencies [19c7aa2]
- Updated dependencies [80e7bae]
- Updated dependencies [08081fa]
- Updated dependencies [7b7d73c]
- Updated dependencies [f8527b2]
- Updated dependencies [9a83b22]
- Updated dependencies [8178fdb]
- Updated dependencies [f635dbe]
  - chat@4.42.0
  - @chat-adapter/shared@4.42.0

## 4.41.1

### Patch Changes

- Updated dependencies [6f17495]
  - chat@4.41.1
  - @chat-adapter/shared@4.41.1

## 4.41.0

### Patch Changes

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

- 7609d8f: Validate external request targets before sending credentials, message content, or attachment requests.
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

- 2a2b2c5: Add a native Instagram Direct Messages adapter with signed webhooks, media, quick replies, story context, reactions, and typed Meta API errors.

### Patch Changes

- Updated dependencies [2a2b2c5]
- Updated dependencies [4ac0455]
- Updated dependencies [0ec6a73]
- Updated dependencies [85e3d22]
  - chat@4.37.0
  - @chat-adapter/shared@4.37.0
