---
"@chat-adapter/teams": patch
---

Send image `attachments` on Teams messages instead of dropping them. An image with `data` or `fetchData` is sent inline as a base64 data URI, and an image with only an HTTPS `url` is sent by reference. Other attachment types are skipped with a warning and the rest of the message still posts.
