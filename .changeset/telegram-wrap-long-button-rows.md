---
"@chat-adapter/telegram": patch
---

Wrap an actions block with more than 8 buttons into inline keyboard rows of 8. Telegram keeps only the first 8 buttons of a row and silently drops the rest, so cards with long button lists lost their last options.
