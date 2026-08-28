---
"@chat-adapter/shared": minor
"@chat-adapter/slack": patch
"@chat-adapter/discord": patch
"@chat-adapter/telegram": patch
"@chat-adapter/whatsapp": patch
---

guard attachment downloads across the remaining adapters

Slack, Discord, and WhatsApp attachment downloads now go through the shared guarded downloader: private and internal addresses are refused (as URL literals, through DNS resolution, and after redirects), responses are capped at 25 MB, and downloads time out after 30 seconds. Slack sends the bot token only on hops to trusted Slack origins, and WhatsApp keeps its access token on Meta's media hosts and the configured Graph origin. Telegram enforces the same size cap and timeout with the Web Fetch API so downloads keep working in runtimes like Cloudflare Workers.

`downloadAttachment` in `@chat-adapter/shared` now resolves `headers` per hop (pass a function to control what each redirect target receives), forwards the resolved headers to custom transports, and accepts an `onResponse` hook to reject unexpected final responses before the body is read.
