---
"@chat-adapter/discord": patch
---

Implement `rehydrateAttachment` on the Discord adapter. Serialization strips an attachment's `fetchData` closure (queue/debounce strategies), and consumers rebuild it via `adapter.rehydrateAttachment`. The Discord adapter did not implement the method, so downstream consumers could not download inbound Discord attachments after deserialization. The Discord CDN `url` survives serialization, so `fetchData` is now rebuilt to fetch that url (preserving its signed query params), matching how the other adapters implement the method.
