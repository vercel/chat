---
"chat": minor
"@chat-adapter/discord": patch
"@chat-adapter/gchat": patch
"@chat-adapter/github": patch
"@chat-adapter/gitlab": patch
"@chat-adapter/teams": patch
---

Add `BaseFormatConverter.parseIncoming()`, which returns a message's `text` and `formatted` AST from a single markdown parse. Very long text can be slow to parse, so text longer than `maxIncomingParseLength` (default `DEFAULT_MAX_INCOMING_PARSE_LENGTH`, 16,384 characters) skips parsing: `text` holds the raw input and `formatted` holds it as a single text node. Subclasses can override `maxIncomingParseLength`.

The Discord, Google Chat, GitHub, GitLab, and Teams adapters now use `parseIncoming()` for incoming messages, so they parse each message once instead of twice. Messages over the limit keep their content but lose markdown structure in `formatted`. In Teams, `text` for such a message also keeps the raw HTML tags, and in GitLab a mention inside a code block or quote in such a note counts as a mention.

Upstream releases fix slow parsing of long lists in `mdast-util-from-markdown` 2.1.0 and of large tables in `micromark-extension-gfm-table` 2.1.2. Both are within the ranges Chat SDK's dependencies already accept, so update them in your lockfile to pick up the fixes. Keep `micromark` at 4.0.2, since 4.0.3 slows down parsing of block quotes, nested lists, and setext headings.
