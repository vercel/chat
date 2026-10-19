---
"@chat-adapter/shared": patch
---

Make `maskCodeSpans` and `replaceBareMentions` take linear time on text with many inline code spans. Each inline span checked for a line break by searching the rest of the text, so a long message of short spans, such as `` `a`a`a… ``, took quadratic time. The check now covers only the span itself, and the output is unchanged.
