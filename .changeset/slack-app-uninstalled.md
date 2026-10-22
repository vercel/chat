---
"@chat-adapter/slack": minor
---

Dispatch Slack `app_uninstalled` events to `onUninstalled` handlers. Subscribe your Slack app to the `app_uninstalled` bot event to receive them. `event.conversationId` is the installation key, the `team_id` or the `enterprise_id` for org-wide installs, so a handler can pass it to `deleteInstallation`. Because Slack revokes the app's tokens before it sends the event, the adapter dispatches it without resolving a bot token, including when an `installationProvider` no longer returns the installation. `tokens_revoked` events don't call `onUninstalled`, because Slack also sends them for revocations that leave the app installed. An `onUninstalled` handler written for Teams now also receives Slack uninstalls, so check `event.adapter.name` in handlers that assume Teams payloads.
