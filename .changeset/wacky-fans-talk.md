---
"@chat-adapter/whatsapp": patch
---

fix whatsapp card media duplication

- Prevent card titles and body content from appearing twice when sending cards with files on WhatsApp.
- Avoid adding the full card fallback text as an image caption when an interactive message follows.
- Keep interactive WhatsApp messages responsible for rendering card titles, bodies, and actions.
