# @chat-adapter/gitlab

## 4.43.0

### Minor Changes

- 115cd39: Add `@chat-adapter/gitlab` for merge request and issue comment threads on GitLab.com, GitLab Self-Managed, and GitLab Dedicated. It verifies webhooks with a signing token or secret token, replies inside each comment's discussion, handles emoji reactions, uploads files, and resolves `message.subject` to the parent merge request or issue. Registers the adapter in `@chat-adapter/catalog` and the `create-chat-sdk` CLI scaffold, and adds GitLab emoji platform support.

### Patch Changes

- Updated dependencies [115cd39]
- Updated dependencies [36325f3]
- Updated dependencies [a32470e]
- Updated dependencies [228b30d]
  - chat@4.43.0
  - @chat-adapter/shared@4.43.0
