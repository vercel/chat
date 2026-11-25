---
"@chat-adapter/telegram": patch
---

Pass `Button` and `LinkButton` `style` to Telegram inline keyboard buttons. `"primary"` and `"danger"` are sent as Telegram's `style` field and shown in blue and red. For `"default"`, no `style` is sent.
