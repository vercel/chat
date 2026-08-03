---
"chat": patch
---

Close residual gaps in agent read-tool scoping. `createChatTools`'s read guard now wraps modal, assistant-thread, assistant-context, app-home, app-context, and member-joined dispatch so tools built in those handlers inherit the active conversation, and it logs a warning (instead of failing open silently) when a read runs with no resolvable scope. Scoping stays channel-level by default, so a thread scope still permits sibling threads in its channel. Pass the new `strictScope: true` to tighten a thread scope to that thread alone, rejecting sibling threads on platforms with per-thread ACLs (Discord, GitHub).
