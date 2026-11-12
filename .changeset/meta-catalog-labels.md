---
"@chat-adapter/catalog": patch
---

Correct three Meta adapter entries. Messenger: fields render as plain text, message history comes from an in-memory cache of received and sent messages, there is no mention detection, and the adapter has no custom API endpoint option. Instagram: message history comes from an in-memory cache of received and sent messages. WhatsApp: message history comes from the thread history that Chat SDK persists in the state adapter.
