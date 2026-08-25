---
"@chat-adapter/shared": minor
"@chat-adapter/messenger": patch
---

guard Messenger attachment downloads against SSRF and oversized responses

`downloadAttachment` in `@chat-adapter/shared` accepts an optional `hosts` allowlist that restricts downloads, including redirect targets, to the given hosts and their subdomains. The Messenger adapter uses it to download attachment media only from Meta's `fbsbx.com` and `fbcdn.net` hosts, with the shared SSRF guard, 25 MB size cap, and 30 second timeout. External fallback and link-share URLs are rejected before any network request.
