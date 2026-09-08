---
"chat": minor
"@chat-adapter/teams": minor
"@chat-adapter/tests": minor
---

Add `onInstalled` and `onUninstalled` handlers for installation lifecycle events. The Teams adapter emits them for `installationUpdate` activities, including the `add-upgrade` and `remove-upgrade` actions, with a persistable `channelId` for later proactive messages.
