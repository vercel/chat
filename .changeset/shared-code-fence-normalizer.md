---
"@chat-adapter/shared": minor
"@chat-adapter/whatsapp": patch
---

Add `normalizeCodeFences` to `@chat-adapter/shared`: a code-fence normalizer for platforms whose triple-backtick fences treat the text after the opening fence as code rather than a CommonMark info string. Only paired fences become code blocks (unpaired fences, fences inside inline code, and fences on quoted lines stay literal text), text following a closing fence cannot be promoted to a block construct, and per-segment callbacks keep text-level rewrites out of code content.

The WhatsApp adapter now uses it when parsing incoming messages: the first line of a code block is preserved in message text and formatted content, and bold/strikethrough rewriting no longer corrupts fenced code.
