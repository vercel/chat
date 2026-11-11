---
"@chat-adapter/telegram": patch
---

Wrap an actions block with more than 8 buttons into evenly sized inline keyboard rows of at most 8. Telegram keeps only the first 8 buttons of a row and silently drops the rest, so cards with long button lists lost their last options.
