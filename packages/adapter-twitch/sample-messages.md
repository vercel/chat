# Twitch sample messages

EventSub webhook bodies the adapter parses. The JSON comes from Twitch's
[EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/)
and [webhook handling](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/)
reference pages. Twitch's examples show the WebSocket transport in
`subscription.transport`; webhook deliveries carry `method: "webhook"` and a
`callback` instead, and the event shape is the same.

Every request also carries these headers:

```
Twitch-Eventsub-Message-Id: e76c6bd4-55c9-4987-8304-da1588d8988b
Twitch-Eventsub-Message-Retry: 0
Twitch-Eventsub-Message-Type: notification
Twitch-Eventsub-Message-Signature: sha256=<hex HMAC-SHA256 of id + timestamp + body>
Twitch-Eventsub-Message-Timestamp: 2023-11-06T18:11:47.492253549Z
Twitch-Eventsub-Subscription-Type: channel.chat.message
Twitch-Eventsub-Subscription-Version: 1
```

## `channel.chat.message` notification

```json
{
  "subscription": {
    "id": "0b7f3361-672b-4d39-b307-dd5b576c9b27",
    "status": "enabled",
    "type": "channel.chat.message",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1971641",
      "user_id": "2914196"
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQHR3s6Mb4T8GFB1l3DlPfiRIGY2VsbC1h"
    },
    "created_at": "2023-11-06T18:11:47.492253549Z",
    "cost": 0
  },
  "event": {
    "broadcaster_user_id": "1971641",
    "broadcaster_user_login": "streamer",
    "broadcaster_user_name": "streamer",
    "chatter_user_id": "4145994",
    "chatter_user_login": "viewer32",
    "chatter_user_name": "viewer32",
    "message_id": "cc106a89-1814-919d-454c-f4f2f970aae7",
    "message": {
      "text": "Hi chat",
      "fragments": [
        {
          "type": "text",
          "text": "Hi chat",
          "cheermote": null,
          "emote": null,
          "mention": null
        }
      ]
    },
    "color": "#00FF7F",
    "badges": [
      {
        "set_id": "moderator",
        "id": "1",
        "info": ""
      },
      {
        "set_id": "subscriber",
        "id": "12",
        "info": "16"
      },
      {
        "set_id": "sub-gifter",
        "id": "1",
        "info": ""
      }
    ],
    "message_type": "text",
    "cheer": null,
    "reply": null,
    "channel_points_custom_reward_id": null,
    "source_broadcaster_user_id": null,
    "source_broadcaster_user_login": null,
    "source_broadcaster_user_name": null,
    "source_message_id": null,
    "source_badges": null
  }
}
```

## `channel.chat.message` in a shared chat session

`source_broadcaster_*`, `source_message_id`, and `source_badges` are set when
the message was sent in another channel of the session.

```json
{
  "subscription": {
    "id": "0b7f3361-672b-4d39-b307-dd5b576c9b27",
    "status": "enabled",
    "type": "channel.chat.message",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1971641",
      "user_id": "2914196"
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQHR3s6Mb4T8GFB1l3DlPfiRIGY2VsbC1h"
    },
    "created_at": "2023-11-06T18:11:47.492253549Z",
    "cost": 0
  },
  "event": {
    "broadcaster_user_id": "1971641",
    "broadcaster_user_login": "streamer",
    "broadcaster_user_name": "streamer",
    "chatter_user_id": "4145994",
    "chatter_user_login": "viewer32",
    "chatter_user_name": "viewer32",
    "message_id": "cc106a89-1814-919d-454c-f4f2f970aae7",
    "message": {
      "text": "Hi chat",
      "fragments": [
        {
          "type": "text",
          "text": "Hi chat",
          "cheermote": null,
          "emote": null,
          "mention": null
        }
      ]
    },
    "color": "#00FF7F",
    "badges": [
      {
        "set_id": "moderator",
        "id": "1",
        "info": ""
      },
      {
        "set_id": "subscriber",
        "id": "12",
        "info": "16"
      },
      {
        "set_id": "sub-gifter",
        "id": "1",
        "info": ""
      }
    ],
    "message_type": "text",
    "cheer": null,
    "reply": null,
    "channel_points_custom_reward_id": null,
    "source_broadcaster_user_id": "112233",
    "source_broadcaster_user_login": "streamer33",
    "source_broadcaster_user_name": "streamer33",
    "source_message_id": "e03f6d5d-8ec8-4c63-b473-9e5fe61e289b",
    "source_badges": [
      {
        "set_id": "subscriber",
        "id": "3",
        "info": "3"
      }
    ],
    "is_source_only": true
  }
}
```

## `user.whisper.message` notification

```json
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "user.whisper.message",
    "version": "1",
    "condition": {
      "user_id": "423374343"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "from_user_id": "423374343",
    "from_user_login": "glowillig",
    "from_user_name": "glowillig",
    "to_user_id": "424596340",
    "to_user_login": "quotrok",
    "to_user_name": "quotrok",
    "whisper_id": "some-whisper-id",
    "whisper": {
      "text": "a secret"
    }
  }
}
```

## `webhook_callback_verification`

Sent once after a subscription is created. The adapter responds `200` with the
raw `challenge` string as `text/plain`.

```json
{
  "challenge": "pogchamp-kappa-360noscope-vohiyo",
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "status": "webhook_callback_verification_pending",
    "type": "channel.follow",
    "version": "1",
    "cost": 1,
    "condition": {
      "broadcaster_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  }
}
```

## `revocation`

`subscription.status` is one of `user_removed`, `authorization_revoked`,
`notification_failures_exceeded`, or `version_removed`.

```json
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "status": "authorization_revoked",
    "type": "channel.follow",
    "cost": 1,
    "version": "1",
    "condition": {
      "broadcaster_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  }
}
```

## Create subscription request (`subscribeToChat`)

```json
{
    "type": "channel.chat.message",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}
```

## Send Chat Message response

```json
{ "data": [{ "message_id": "abc-123-def", "is_sent": true }] }
```
