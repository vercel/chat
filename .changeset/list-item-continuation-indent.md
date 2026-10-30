---
"chat": patch
"@chat-adapter/teams": patch
---

`BaseFormatConverter.renderList` keeps list items together in more cases. A list nested under an ordered item now starts at the item's content column. It used to get two spaces, which is too few under `1. `, so the nested items became siblings of their parent. Two blocks in one item, such as two paragraphs, now have a blank line between them instead of merging. A nested ordered list that doesn't start at 1, or a nested list after HTML, also keeps a blank line before it, because it can't follow the block above directly. Converters can also set the new `indentListContinuationLines` property to indent every line of a multi-line block in an item, such as a code block or a block quote. The Teams converter turns it on, so a code block in a list item no longer falls out of the item.
