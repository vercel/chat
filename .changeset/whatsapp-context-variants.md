---
"@chat-adapter/whatsapp": minor
---

Fix the `WhatsAppInboundMessage.context` type to model all documented webhook variants. The type previously declared `context?: { from: string; id: string }`, but Meta's Cloud API sends mutually exclusive context shapes: quoted replies carry `from`/`id`, forwarded messages carry only `forwarded` or `frequently_forwarded` (no `id`), and catalog product inquiries add `referred_product`. Code narrowed by the old type could dereference `context.id` and crash at runtime on forwarded messages. All context fields are now optional and the forwarded/product-inquiry fields are included. Consumers that dereference `context.from` or `context.id` without a guard will now see a type error, surfacing what was already a latent crash on forwarded messages.
