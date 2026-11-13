---
"@chat-adapter/slack": patch
---

Add `unfurlWaitMs` to the Slack adapter to configure polling for missing link previews. Set it to `0` to read cached previews once without waiting, including both snapshots of a message edit. The default polling budget remains 2 seconds per parsed message.
