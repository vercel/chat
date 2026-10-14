---
"chat": patch
---

Keep modal context until the modal closes, so `relatedThread` and `relatedChannel` are still available when a user resubmits after a submit handler returns validation errors, or after an `update` or `push` response.
