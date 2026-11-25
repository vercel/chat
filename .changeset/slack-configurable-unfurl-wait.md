---
"@chat-adapter/slack": minor
---

Add `unfurlWaitMs` to the Slack adapter to configure polling for missing link previews. Set it to `0` to read cached previews once without waiting. The default polling budget remains 2 seconds, and polling now stops at the budget instead of up to one 150 ms poll interval past it, measured on a monotonic clock.

Link-preview polling also waits less in these cases:

- A message edit waits once instead of twice. The previous-message snapshot reads the preview cache a single time.
- The bot's own messages skip the preview lookup, because Chat SDK doesn't pass them to handlers.
- A link whose preview has a description but no title keeps the data from the event. It no longer waits for the cache or takes cached values over the event's.

A failed preview cache read now logs a warning before the adapter delivers the message with the links it has.
