---
"@chat-adapter/gitlab": minor
"chat": minor
"create-chat-sdk": minor
---

Add `@chat-adapter/gitlab` for merge request and issue comment threads on GitLab.com, GitLab Self-Managed, and GitLab Dedicated. It verifies webhooks with a signing token or secret token, replies inside each comment's discussion, handles emoji reactions, uploads files, and resolves `message.subject` to the parent merge request or issue. Registers the adapter in the `chat/adapters` catalog and `create-chat-sdk` CLI scaffold, and adds GitLab emoji platform support.
