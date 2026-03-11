---
"chat": minor
"@chat-adapter/slack": minor
---

feat: add PostablePlatformBlocks message type for raw Block Kit passthrough

Adds a new `PostablePlatformBlocks` type to `AdapterPostableMessage` that allows passing raw platform-specific block payloads (e.g., Slack Block Kit `blocks[]` and `attachments[]`) through `postMessage()` and `editMessage()` without Card abstraction.

This enables advanced use cases like live-updating progress messages with action buttons, custom table attachments, and other platform-specific constructs that the Card system doesn't cover.
