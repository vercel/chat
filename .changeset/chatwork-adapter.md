---
"@chat-adapter/chatwork": minor
---

Add Chatwork adapter for chat SDK

Implements a new adapter for Chatwork with support for:
- Webhook handling with HMAC-SHA256 signature verification
- Sending, editing, and deleting messages via Chatwork REST API v2
- Chatwork-specific format conversion (info/code/hr/To tags to mdast AST)
- Zero-config factory function with environment variable support
