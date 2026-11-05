---
"@chat-adapter/teams": patch
"@chat-adapter/catalog": patch
---

The Teams adapter reports edited messages to `onMessageUpdated`. It used to drop Teams `messageUpdate` activities, so a bot never saw an edit. The updated message has `isMention` set from its mention entities, like a new message. Teams sends only the new version, so `previousMessage` is `undefined`. Undeletes are still ignored.

Webhook options are now scoped to each request instead of the activity id, so an edit that reuses its message's id no longer loses its `waitUntil` while the original message is still being handled.
