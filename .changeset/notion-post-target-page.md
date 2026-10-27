---
"@chat-adapter/notion": patch
---

Reject posts to a discussion or block that isn't on the page in the thread ID. Notion routes a reply by `discussion_id` and a new block discussion by `parent.block_id` without checking the page, so a thread ID such as `notion:{pageA}:{discussionOnPageB}` posted on page B while its channel was page A. `postMessage` now throws a `ValidationError` before uploading files or posting. Block targets are checked against the block's current page, and child page or child database blocks are rejected. Discussion targets must match a page the adapter recorded in the state adapter when a webhook arrived for the discussion, the bot started it, or it appeared in the page's comment list. That list only covers unresolved, page-level discussions, so an inline or block discussion with no record, such as a thread ID saved before this release, is rejected until a new comment in it arrives through the webhook.
