---
"@chat-adapter/x": patch
"@chat-adapter/twitch": patch
---

Keep the paragraphs of a Markdown block quote apart in the X and Twitch converters. Neither converter handled block quotes, so the base fallback joined the quoted blocks with nothing between them and `> First.\n>\n> Second.` came out as `First.Second.`. Now X separates the quoted blocks with a blank line, the same as unquoted paragraphs, and Twitch separates them with a space. Quote children that render to nothing are skipped.
