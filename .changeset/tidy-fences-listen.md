---
"@chat-adapter/slack": patch
---

Preserve the first line of incoming Slack code blocks when extracting message text and formatted content.

Only paired triple-backtick fences become code blocks: an unpaired fence, a fence inside inline code or a `<…>` token, and a fence on a quoted line all stay literal text, matching how Slack renders them. Bold and strikethrough rewriting no longer touches fenced code content, and text following a closing fence can no longer turn into a blockquote, heading, or list.
