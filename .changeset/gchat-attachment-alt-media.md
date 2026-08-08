---
"@chat-adapter/gchat": patch
---

Fix attachment downloads failing with a 400 when `attachmentDataRef` is present

`fetchAttachmentData` called the Chat media endpoint without `alt=media`, so it
returned resource metadata rather than file bytes and rejected the arraybuffer
request with a bare 400. Every download by `resourceName` failed, which is the
path taken for any file uploaded directly to Chat.
