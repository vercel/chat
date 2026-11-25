---
"@chat-adapter/x": patch
"@chat-adapter/twitch": patch
---

Keep the paragraphs of a Markdown block quote apart in the X and Twitch converters. Neither converter handled block quotes, so the base fallback joined the quoted blocks with nothing between them and `> First.\n>\n> Second.` came out as `First.Second.`. Now X separates the quoted blocks with a blank line, the same as unquoted paragraphs, and Twitch separates them with a space. Quote children that render to nothing are skipped. Inside a list item, X now indents every line of a multi-line block, such as a quote with several paragraphs or a code block, to the item's content column instead of only the first line.
