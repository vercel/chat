---
"@chat-adapter/telegram": minor
---

Parse stickers and animations. A sticker used to arrive as an empty message — it carries no text — and an animation (Telegram GIF) was dropped entirely. A sticker now reports the emoji it stands for as its text and an image attachment typed by its real format (WebP, WebM or TGS), and an animation arrives as a video attachment.
