---
"@chat-adapter/teams": patch
"@chat-adapter/catalog": patch
---

The Teams adapter reports edited messages to `onMessageUpdated`. It used to drop Teams `messageUpdate` activities, so a bot never saw an edit. The updated message has `isMention` set from its mention entities, like a new message. Teams sends only the new version, so `previousMessage` is `undefined`. Undeletes are still ignored.
