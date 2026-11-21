---
"@chat-adapter/gchat": patch
---

The Google Chat adapter now gives card clicks and `parseMessage()` results in a direct message the same thread ID as the messages in that conversation: the space-only ID with the `:dm` suffix that `openDM()` returns. Card clicks and `parseMessage()` used to build the ID from the message's thread name without the suffix, so a click arrived on a different thread than the DM's messages and `thread.isDM` was false for it. Reactions delivered through Pub/Sub get the DM thread ID when the fetched message reports a DM space, and Pub/Sub messages get it when the message payload carries the space type. A space counts as a DM when it has `type: "DM"`, `spaceType: "DIRECT_MESSAGE"`, or `singleUserBotDm: true`, and `fetchChannelInfo()` uses the same rule.

Two things change for action handlers in a DM. `event.thread.post()` now posts to the DM without a thread name, the same as a reply from a message handler, where it used to reply in the card message's thread. State and subscriptions that a click handler stored under the old thread ID are not carried over, so move anything you still need to the `:dm` thread ID.
