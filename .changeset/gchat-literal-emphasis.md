---
"@chat-adapter/gchat": patch
---

Bold and strikethrough in incoming Google Chat messages now only apply when the markers wrap text with no space just inside them, and never inside inline code or code blocks. Text such as `2 * 3`, `~10 to ~20`, and `rm -rf *` in code now stays as typed.
