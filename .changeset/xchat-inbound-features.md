---
"@chat-adapter/xchat": minor
---

XChat inbound handling and messaging features:

- Entity-based mention detection (structured mention entities + swipe-reply-to-bot), with plain-text `@handle` fallback
- Group replies sent as quoted replies (`encryptReply`) referencing the triggering message; TTL propagated from the inbound message
- Outgoing rich-text entities (URLs, @mentions) and auto-attached x.com post cards
- Media: inbound attachments exposed with lazy download+decrypt; outbound files encrypted (secretstream) and uploaded via the 3-step media upload flow
- Reactions: inbound routed to `onReaction`, outbound `addReaction`/`removeReaction` implemented
- `chat.conversation_join`: conversation-key bootstrap plus configurable group welcome message
- Read receipts: a seen-until watermark is sent for each delivered inbound message before handlers run (`sendReadReceipts` config, default on), falling back to the latest conversation event when the message carries no sequence id
- Typing keep-alive loop while handlers run; session identity (`setIdentity`) after unlock
- Non-message decrypted events (edits, mark-read, etc.) no longer surface as empty messages
