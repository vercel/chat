---
"chat": minor
---

Close residual gaps in agent read-tool scoping. `createChatTools`'s read guard now wraps modal, assistant-thread, assistant-context, app-home, app-context, and member-joined dispatch so tools built in those handlers inherit the active conversation, and it logs a warning (instead of failing open silently) when a read runs with no resolvable scope. Scoping stays channel-level by default, so a thread scope still permits sibling threads in its channel. Pass the new `strictScope: true` to confine a thread scope to that thread alone, rejecting both sibling threads and the parent channel, which matters on platforms where a channel is the widest read available (a GitHub channel is an entire repo).

Note that reads inside those newly wrapped handlers were previously unscoped. An agent built in an `onModalSubmit`, `onAppHomeOpened`, or `onMemberJoinedChannel` handler that reads another channel will now be rejected. Pass an explicit `scope`, or `scope: false` for intentionally workspace-wide reads.
