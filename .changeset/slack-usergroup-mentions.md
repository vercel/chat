---
"@chat-adapter/slack": minor
---

Resolve Slack user group mentions to their handles. A message that mentions a group as `<!subteam^S0123456789>` now renders as `@handle` in `message.text`, matching how the adapter already resolves user and channel mentions. Before this change, Slack sent no name with the mention, so it rendered as `@S0123456789`.

The adapter reads handles from `usergroups.list`, which returns every group at once, and caches each one in the state adapter for eight days, scoped to the installation, the same way it caches channel names. Add the `usergroups:read` scope to your Slack app. Without it, or if the call fails, the mention renders as before. Mentions that already carry a label keep it.
