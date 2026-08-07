---
"@chat-adapter/whatsapp": minor
---

Add native WhatsApp LinkButton support

- A card whose only interactive element is a single `LinkButton` with a non-empty label and an `http://` or `https://` URL is now sent as a native `cta_url` interactive message, as long as the card has no header image or image, table, chart, or inline link children and the post carries no files or attachments.
- Link button URLs are now appended as `Label: url` lines to interactive button message bodies and to media captions, instead of being dropped.
- Everything else is unchanged: non-matching cards keep the formatted text fallback, and card + media posts keep the single captioned media send.
