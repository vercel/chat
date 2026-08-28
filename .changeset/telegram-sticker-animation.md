---
"@chat-adapter/telegram": minor
---

Parse stickers and animations. A sticker used to arrive as an empty message, since it carries no text, and an animation (Telegram GIF) was dropped entirely. A sticker now reports the emoji it stands for as its text (falling back to the sticker set name, then to "sticker") plus an attachment matching its real format: an image for a still WebP sticker, a video for a WebM one, a file for a Lottie (TGS) one. An animation arrives as a single video attachment; the redundant `document` field Telegram sets alongside it for backward compatibility is no longer reported as a second attachment.
