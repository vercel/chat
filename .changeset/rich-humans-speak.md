---
"@chat-adapter/slack": minor
---

Add support for external `installationProvider` and Enterprise Grid org-wide installs.

- New optional `installationProvider` config: `{ getInstallation(installationId, isEnterpriseInstall) => Promise<SlackInstallation | null> }`. When set, the adapter resolves bot tokens for incoming events, slash commands, and interactive payloads through the provider instead of the internal `StateAdapter` — useful for hosted token-management systems (e.g. Vercel Connect). The provider is read-only; OAuth callback writes (`setInstallation`, `handleOAuthCallback`) and the `getInstallation`/`deleteInstallation` public methods continue to use internal state, so callers using a provider should manage their own writes.
- Enterprise Grid org-wide installs (`is_enterprise_install: true`) are now keyed on `enterprise_id` instead of `team_id` across event_callback, slash command, and interactive payload paths. Multi-workspace deployments using the internal `StateAdapter` for org-wide installs must repopulate installations under the `enterprise_id` key — previously, org-wide events would fall through to a `team_id` lookup that did not match what the OAuth flow had stored.
