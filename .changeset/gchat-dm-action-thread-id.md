---
"@chat-adapter/gchat": patch
---

The Google Chat adapter now gives a card click in a direct message the same thread ID as the messages in that conversation. It used to build the click's thread ID from the card message's thread name and without the `:dm` suffix, so the click arrived on a different thread than the DM's messages. Handlers that look up state by `event.threadId`, and `thread.isDM`, now behave the same for clicks as for messages.
