---
"@chat-adapter/slack": minor
---

Resolve Slack user group mentions to their handles. A message that mentions a group as `<!subteam^S0123456789>` now renders as `@handle` in `message.text`, matching how the adapter already resolves user and channel mentions. Before this change, Slack sent no name with the mention, so it rendered as `@S0123456789`.

The adapter reads handles from `usergroups.list`, which returns every group at once, and caches them in the state adapter as one entry per workspace, scoped to the installation. It lists the groups again after 24 hours, or sooner if your app subscribes to the `subteam_created` and `subteam_updated` events. Add the `usergroups:read` scope to your Slack app. Without it, or if the call fails, the mention renders as before and the adapter waits five minutes before calling again. Mentions that already carry a label keep it.
