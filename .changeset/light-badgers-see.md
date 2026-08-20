---
"@chat-adapter/discord": patch
---

fix edits, deletes, and reactions on Discord thread starter messages

Operations on a thread's starter message now try the thread first and fall back to the parent channel when Discord reports the message as unknown. Threads on a text channel keep their starter message in the parent channel, so those operations used to fail; forum and media posts keep theirs in the thread and are unaffected.

Note that deleting a text-channel thread's starter message now deletes the message, which Discord cascades into deleting the thread.
