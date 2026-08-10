---
"@chat-adapter/gchat": patch
---

Fix attachment downloads failing with a 400 when `attachmentDataRef` is present

`fetchAttachmentData` called the Chat media endpoint without `alt=media`, so it
returned resource metadata rather than file bytes and rejected the arraybuffer
request with a bare 400. Every download by `resourceName` failed, which is the
path taken for any file uploaded directly to Chat.

The download path is also hardened: when `media.download` fails and the
attachment carries a `downloadUri`, the adapter now falls back to fetching that
URL instead of rejecting, and failures with no fallback are routed through the
shared error handling so a 429 surfaces as `AdapterRateLimitError` like every
other Chat API call.
