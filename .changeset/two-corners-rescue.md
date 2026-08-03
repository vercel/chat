---
"@chat-adapter/slack": patch
---

Preserve the Slack channel ID when converting labeled channel tokens (`<#C123|general>` now becomes `#general (C123)`) so agents can pass the ID to channel tools, and normalize the commonly hallucinated `<label|url>` link order before Markdown conversion
