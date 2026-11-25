---
"chat": minor
---

Thread history now stores each message's `formatted` tree without the parser's `position` data, which cuts the stored size of a formatted message by about three to four times. Messages read back from thread history no longer have `position` on their nodes. Add `history.thread.storeFormatted`: set it to `false` to store a single text node holding the message's `text` in place of the tree. Entries stored before this change still load as they were stored.
