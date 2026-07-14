---
"chat": patch
"@chat-adapter/slack": patch
---

Add optional `isSystem` field to the normalized message `Author` type to distinguish platform-generated messages from humans and bots. The Slack adapter now sets `isSystem: true` for messages authored by Slack's reserved `USLACK` user (e.g. "@user archived the channel" notifications in DMs), so consumers no longer need to hard-code Slack-specific user IDs.
