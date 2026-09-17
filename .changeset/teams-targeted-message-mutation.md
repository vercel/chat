---
"@chat-adapter/teams": patch
---

Edit and delete Microsoft Teams targeted messages through the `?isTargetedActivity=true` endpoint, so a message sent with `postEphemeral` can be updated or removed instead of failing with `400 Bad argument`. The ids sent targeted are recorded in the Chat state adapter with a 24-hour TTL, matching how long Teams keeps a targeted message.
