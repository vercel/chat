---
"@chat-adapter/catalog": patch
"create-chat-sdk": patch
---

Point the Photon vendor-official adapter at `@photon-ai/chat-adapter`, which replaces `@photon-ai/chat-adapter-imessage`. The catalog entry, docs page, and CLI scaffold now use `createPhotonAdapter` and the `PHOTON_*` environment variables.
