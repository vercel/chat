---
"@chat-adapter/slack": patch
---

Bound the length of bracketed URLs parsed from message text in the link-unfurl fallback, avoiding a quadratic scan on adversarial input. Valid links are unaffected.
