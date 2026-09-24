# Sample Discord payloads

Real payloads captured from a test guild, taken from the replay fixture in
`packages/integration-tests/fixtures/replay/discord.json`. Snowflakes and
names are from that fixture. Extend this file when a parser changes or a new
event type gets handled.

Fields the Gateway forwarder adds before posting to the webhook are marked
below; Discord itself does not send them.

## Message component interaction (button click in a thread)

HTTP interaction, `type: 3`. Note `channel.type: 11` with `channel.parent_id`
set: the adapter reads both to encode the thread id as
`discord:{guild_id}:{parent_id}:{channel_id}`. The nested `message` object
is trimmed here.

```json
{
  "app_permissions": "2248473465835073",
  "application_id": "1457469483726668048",
  "attachment_size_limit": 10485760,
  "authorizing_integration_owners": {
    "0": "1457468924290662599"
  },
  "channel": {
    "flags": 0,
    "guild_id": "1457468924290662599",
    "id": "1457536551830421524",
    "last_message_id": "1457536567810854934",
    "member": {
      "flags": 0,
      "id": "1457536551830421524",
      "join_timestamp": "2026-01-05T00:49:57.143000+00:00",
      "mute_config": null,
      "muted": false,
      "user_id": "1033044521375764530"
    },
    "member_count": 2,
    "member_ids_preview": [
      "1033044521375764530",
      "1457469483726668048"
    ],
    "message_count": 1,
    "name": "Thread 1/5/2026, 12:49:56 AM",
    "owner_id": "1457469483726668048",
    "parent_id": "1457510428359004343",
    "permissions": "9007199254740991",
    "rate_limit_per_user": 0,
    "thread_metadata": {
      "archive_timestamp": "2026-01-05T00:49:57.102000+00:00",
      "archived": false,
      "auto_archive_duration": 1440,
      "create_timestamp": "2026-01-05T00:49:57.102000+00:00",
      "locked": false
    },
    "total_message_sent": 1,
    "type": 11
  },
  "channel_id": "1457536551830421524",
  "context": 0,
  "data": {
    "component_type": 2,
    "custom_id": "hello",
    "id": 2
  },
  "entitlement_sku_ids": [],
  "entitlements": [],
  "guild": {
    "features": [],
    "id": "1457468924290662599",
    "locale": "en-US"
  },
  "guild_id": "1457468924290662599",
  "guild_locale": "en-US",
  "id": "1457536583141163186",
  "locale": "en-US",
  "member": {
    "avatar": null,
    "banner": null,
    "collectibles": null,
    "communication_disabled_until": null,
    "deaf": false,
    "display_name_styles": null,
    "flags": 0,
    "joined_at": "2026-01-04T20:21:10.139000+00:00",
    "mute": false,
    "nick": null,
    "pending": false,
    "permissions": "9007199254740991",
    "premium_since": null,
    "roles": [],
    "unusual_dm_activity_until": null,
    "user": {
      "avatar": "046f57d76d14a232a4ddc7200080de76",
      "avatar_decoration_data": null,
      "clan": null,
      "collectibles": null,
      "discriminator": "0",
      "display_name_styles": null,
      "global_name": "Test User",
      "id": "1033044521375764530",
      "primary_guild": null,
      "public_flags": 0,
      "username": "testuser2384"
    }
  },
  "message": {
    "id": "1457536567810854934",
    "channel_id": "1457536551830421524",
    "type": 0
  },
  "token": "aW50ZXJhY3Rpb246MTQ1NzUzNjU4MzE0MTE2MzE4Njp2UzduREJSaHRxYnV1RzVGN2FIZEJHTkMyRTZiRlZ6WjBXUEQyZ1FhTWVPVnpDbmdvZTIyeldZeWpGaXNlQkxOc2hpbWNFSjdYTWcwMkNPdTV1QTlna3ozR01TUWh1MDdDZ09MRjd4aW1MNldZeWp6MHlDbEpVcW1nUFdsdkhtTw",
  "type": 3,
  "version": 1
}
```

## Forwarded MESSAGE_REACTION_ADD (guild channel)

Envelope posted by the Gateway forwarder to the webhook endpoint. Discord
sends no `channel_type`; guild reactions carry `member.user`, DM reactions
carry neither `member` nor `guild_id`.

```json
{
  "type": "GATEWAY_MESSAGE_REACTION_ADD",
  "timestamp": 1767574292322,
  "data": {
    "user_id": "1033044521375764530",
    "type": 0,
    "message_id": "1457536955662471180",
    "message_author_id": "1457469483726668048",
    "member": {
      "user": {
        "username": "testuser2384",
        "public_flags": 0,
        "primary_guild": null,
        "id": "1033044521375764530",
        "global_name": "Test User",
        "display_name_styles": null,
        "display_name": "Test User",
        "discriminator": "0",
        "collectibles": null,
        "bot": false,
        "avatar_decoration_data": null,
        "avatar": "046f57d76d14a232a4ddc7200080de76"
      },
      "roles": [],
      "premium_since": null,
      "pending": false,
      "nick": null,
      "mute": false,
      "joined_at": "2026-01-04T20:21:10.139000+00:00",
      "flags": 0,
      "deaf": false,
      "communication_disabled_until": null,
      "banner": null,
      "avatar": null
    },
    "emoji": {
      "name": "👍",
      "id": null
    },
    "channel_id": "1457536551830421524",
    "burst": false,
    "guild_id": "1457468924290662599"
  }
}
```

Forwarder-added fields on `data`, not present in the raw dispatch:

| Field | When | Source |
| --- | --- | --- |
| `channel_type` | channel resolved via `client.channels.fetch` | `channel.type` |
| `thread` | `channel_type` is a thread | `{ id: channel.id, parent_id: channel.parentId }` |
| `user` | no `member` on the dispatch (DMs) | `client.users.fetch(user_id)` |

## Forwarded MESSAGE_CREATE (mention in a guild channel)

```json
{
  "type": "GATEWAY_MESSAGE_CREATE",
  "timestamp": 1767574193867,
  "data": {
    "type": 0,
    "tts": false,
    "timestamp": "2026-01-05T00:49:53.676000+00:00",
    "pinned": false,
    "nonce": "1457536551075446784",
    "mentions": [
      {
        "username": "Chat SDK Demo",
        "public_flags": 524288,
        "primary_guild": null,
        "member": {
          "roles": [
            "1457473602180878604"
          ],
          "premium_since": null,
          "pending": false,
          "nick": null,
          "mute": false,
          "joined_at": "2026-01-04T20:39:45.451082+00:00",
          "flags": 0,
          "deaf": false,
          "communication_disabled_until": null,
          "banner": null,
          "avatar": null
        },
        "id": "1457469483726668048",
        "global_name": null,
        "display_name_styles": null,
        "discriminator": "6184",
        "collectibles": null,
        "clan": null,
        "bot": true,
        "avatar_decoration_data": null,
        "avatar": null
      }
    ],
    "mention_roles": [],
    "mention_everyone": false,
    "member": {
      "roles": [],
      "premium_since": null,
      "pending": false,
      "nick": null,
      "mute": false,
      "joined_at": "2026-01-04T20:21:10.139000+00:00",
      "flags": 0,
      "deaf": false,
      "communication_disabled_until": null,
      "banner": null,
      "avatar": null
    },
    "id": "1457536551830421524",
    "flags": 0,
    "embeds": [],
    "edited_timestamp": null,
    "content": "<@1457469483726668048> Hey",
    "components": [],
    "channel_type": 0,
    "channel_id": "1457510428359004343",
    "author": {
      "username": "testuser2384",
      "public_flags": 0,
      "primary_guild": null,
      "id": "1033044521375764530",
      "global_name": "Test User",
      "display_name_styles": null,
      "discriminator": "0",
      "collectibles": null,
      "clan": null,
      "avatar_decoration_data": null,
      "avatar": "046f57d76d14a232a4ddc7200080de76"
    },
    "attachments": [],
    "guild_id": "1457468924290662599"
  }
}
```

The forwarder adds `thread: { id, parent_id }` when `respondToChannelIds` is
set and the message was posted in a thread under one of those channels.

## Still to capture

- `APPLICATION_COMMAND` chat input interaction (`data.type: 1`) with
  subcommand options.
- `APPLICATION_COMMAND` context menu interaction (`data.type: 2` or `3`).
  Routed to `onSlashCommand` under `data.name`; `data.target_id` and
  `data.resolved` hold the target. The unit test in `index.test.ts` uses a
  hand-written payload until a real one lands here.
- Forwarded `MESSAGE_REACTION_ADD` from a DM (no `member`, no `guild_id`).
