---
"@chat-adapter/gchat": patch
---

- Fix redundant mailto link rendering in Google Chat adapter
- Google Chat adapter was emitting redundant `<mailto:...|...>` tokens when rendering autolinked email addresses. This change collapses `mailto:` URLs when the visible text equals the email address, ensuring cleaner output consistent with plain text rendering in Google Chat.
