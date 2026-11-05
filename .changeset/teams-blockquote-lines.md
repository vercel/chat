---
"@chat-adapter/teams": patch
---

The Teams converter now quotes every line of a Markdown block quote. It used to add the `> ` prefix only to the first line of each block and join blocks with a single newline. Teams then merged the paragraphs of the quote and folded every list item after the first into the first one. Now each line gets the prefix, and a lone `>` line separates the blocks.
