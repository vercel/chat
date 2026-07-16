---
"@chat-adapter/slack": minor
---

Enterprise Grid fixes:

- `handleOAuthCallback` now handles org-wide installs (`is_enterprise_install`): Slack returns `team: null` for these, and the installation is now keyed by the enterprise ID — the same key webhook token resolution looks up — instead of failing. The result includes `enterpriseId` and `isEnterpriseInstall`, and `SlackInstallation` records both.
- Socket mode now resolves per-installation tokens for events, slash commands, and interactive payloads in multi-workspace deployments (matching the HTTP webhook path), and no longer drops `enterprise_id` / `is_enterprise_install` / `is_ext_shared_channel` from event payloads.
- The user profile cache and display-name mention reverse index are now scoped by installation in multi-workspace deployments, so profiles fetched with one workspace's token no longer bleed into another and mentions can no longer resolve to a same-named user from a different workspace. Existing cache entries repopulate on first lookup (single-workspace keys are unchanged).
