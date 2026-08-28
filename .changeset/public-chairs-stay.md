---
"@chat-adapter/shared": minor
"@chat-adapter/teams": patch
---

secure anonymous attachment downloads against SSRF and oversized responses

`@chat-adapter/shared` gains `downloadAttachment`, a guarded downloader that refuses private and internal addresses (as URL literals, through DNS resolution, and after redirects), decodes compressed responses, caps the body size at 25 MB, and bounds the whole download with a 30 second timeout. All of these are configurable, including the transport for proxied deployments.

The Teams adapter uses it for anonymous attachment downloads. HTTPS attachments on any public host keep working, plain-HTTP URLs are refused, and the Bot Framework Emulator's loopback connector now uses bot authentication so local development keeps working.
