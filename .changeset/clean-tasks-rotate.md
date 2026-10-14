---
"@chat-adapter/slack": patch
---

Complete open task cards when a native Slack stream segment rotates, then replay the in-progress cards in the next segment. Retired segments now finish without Slack's error indicator. If Slack rejects the closing task cards, the adapter finalizes the segment without them and streams the rest of the reply as text only.
