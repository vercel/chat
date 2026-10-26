---
"@chat-adapter/telegram": minor
---

Add a `longMessages: "split"` option that sends text posts longer than Telegram's message limit as consecutive messages instead of truncating them. Split tables repeat their header row, and a rate-limited part is sent again after Telegram's `retry_after` period. Ordered lists in MarkdownV2 messages now keep their start number.
