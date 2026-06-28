---
"@chat-adapter/discord": patch
---

fix bare-mention conversion so it no longer mangles surrounding text: email addresses and `word@word` handles are left intact (the `@` must be at a word boundary), already-formatted mentions like `<@123>` are no longer double-wrapped into `<<@123>>`, and a real mention that follows a period (e.g. `docs.@everyone`) still converts
