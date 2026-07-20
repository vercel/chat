---
"@chat-adapter/slack": minor
---

Enterprise Grid fixes:

- `handleOAuthCallback` now handles org-wide installs (`is_enterprise_install`): Slack returns `team: null` for these, and the installation is now keyed by the enterprise ID — the same key webhook token resolution looks up — instead of failing. The result includes `enterpriseId` and `isEnterpriseInstall`, and `SlackInstallation` records both.
- Socket mode now resolves per-installation tokens for events, slash commands, and interactive payloads in multi-workspace deployments (matching the HTTP webhook path), and no longer drops `enterprise_id` / `is_enterprise_install` / `is_ext_shared_channel` from event payloads.
- The user profile cache and display-name mention reverse index are now scoped by installation in multi-workspace deployments, so profiles fetched with one workspace's token no longer bleed into another and mentions can no longer resolve to a same-named user from a different workspace. Existing cache entries repopulate on first lookup (single-workspace keys are unchanged).
- API calls made while handling an event from an org-wide install now pass the event's `team_id` explicitly, as Slack requires for workspace-scoped methods (`conversations.list`, `usergroups.*`, …) on org tokens. When an event carries a `context_team_id` (shared channels hosted on an "away" workspace), channel-addressed calls echo it back as `client_context_team_id`.
- Retried event deliveries (`x-slack-retry-num`, socket `retry_num`) are dropped when the original delivery was already dispatched, using an `event_id` marker in the state adapter (24-hour TTL). Events whose first delivery never arrived are still recovered via the retry.
- Bare `@W…` mentions in outgoing messages are now recognized as raw Enterprise Grid user IDs (previously only `@U…` was), so they render as real mentions instead of being treated as display names.
- Event token resolution now prefers the envelope's `authorizations[0]` — Slack's documented location for the event's installation identity — over the top-level `team_id`/`enterprise_id`, which can name a different workspace for Slack Connect shared-channel events. Top-level fields remain as a fallback.
