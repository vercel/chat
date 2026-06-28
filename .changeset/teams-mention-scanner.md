---
"@chat-adapter/teams": patch
---

use the shared `replaceBareMentions` scanner for `@mention` conversion so email addresses, `@handles` inside URLs, and mentions inside code spans are no longer mangled into `<at>` mention tags
