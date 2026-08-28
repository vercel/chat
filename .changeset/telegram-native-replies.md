---
"@chat-adapter/telegram": minor
---

Implement `reply` in the Telegram adapter so `Thread.reply()` threads the answer to its target instead of throwing `NotImplementedError`. The reference travels as Bot API `reply_parameters` and covers text, rich messages, documents, attachments and media groups; `allow_sending_without_reply` keeps delivery working when the target has been deleted. Malformed reply target ids are rejected before anything is sent, and a rich-message gateway that rejects `reply_parameters` falls back to a regular threaded send.
