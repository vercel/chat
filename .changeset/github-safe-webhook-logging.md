---
"@chat-adapter/github": patch
---

Remove raw GitHub webhook payload previews from adapter logs.

Debug and error logs now report only request-shape metadata, such as body size, event type, content type, and signature presence, instead of copying provider payload content into logs.
