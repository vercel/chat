---
"chat": minor
"@chat-adapter/slack": minor
---

Add `channelVisibility` enum to distinguish private, workspace, external, and unknown channel scopes. Implements `getChannelVisibility()` on the Adapter interface and Slack adapter, replacing the previous `isExternalChannel` boolean.
