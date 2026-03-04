---
"@chat-adapter/discord": patch
"@chat-adapter/gchat": patch
"@chat-adapter/slack": patch
"@chat-adapter/teams": patch
---

Fix nested list rendering in Markdown-to-platform converters

All adapters (Slack, Discord, Teams, Google Chat) were flattening nested
lists during `fromAst()` conversion, causing child items to be concatenated
directly onto the parent item without any indentation or newline separation.

The `nodeToX()` list handler now accepts a `depth` parameter and uses it to
produce platform-appropriate indentation (`"  ".repeat(depth)`) for nested
lists. Each list item's children are processed in order: paragraph content
is prefixed with the bullet/number at the correct indent level, and nested
list nodes are rendered recursively at `depth + 1`.
