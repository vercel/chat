---
"chat": patch
"@chat-adapter/discord": patch
"@chat-adapter/slack": patch
"@chat-adapter/gchat": patch
"@chat-adapter/teams": patch
---

Quote every line of a Markdown block quote in the Discord, Slack, and Google Chat converters. Each converter added the `> ` prefix only to the first line of each block inside a quote, so later lines, list items, and code block lines fell out of the quote, and quoted paragraphs ran together. Slack hit this only on `response_url` replies. Now every line gets the prefix, and a quoted blank line separates the blocks. On Discord, which only quotes a line that starts with `> `, blank quoted lines keep the trailing space.

The rendering now lives in a new `renderBlockquote` method on `BaseFormatConverter`, which the Teams converter also uses. It skips a quote child that renders to nothing, such as a link definition, so a quote no longer starts or ends with a blank quoted line.
