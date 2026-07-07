# X sample messages

Real payloads captured from the X Activity API via the persistent stream
(`GET /2/activity/stream`) and the create-post endpoint. Third-party account
details are replaced with placeholders; the structure and field names are
verbatim from live traffic.

## post.mention.create (inbound mention)

Delivered when someone mentions the authenticated account. The event envelope
is `data.event_type` + `data.payload`; the payload is the post object itself,
and the author is **not** inline: it lives in `data.includes.users[]`, matched
to `payload.author_id`. IDs are strings (no numeric precision loss).

```json
{
  "data": {
    "event_uuid": "1900000000000000001",
    "filter": {
      "user_id": "222222222"
    },
    "event_type": "post.mention.create",
    "tag": "chat-sdk-x-capture",
    "payload": {
      "id": "1900000000000000001",
      "conversation_id": "1900000000000000001",
      "entities": {
        "mentions": [
          {
            "start": 0,
            "start_str": "0",
            "end": 10,
            "end_str": "10",
            "username": "mybot",
            "id": "222222222"
          }
        ]
      },
      "author_id": "111111111",
      "paid_partnership": false,
      "possibly_sensitive": false,
      "lang": "en",
      "display_text_range": [
        0,
        26
      ],
      "reply_settings": "everyone",
      "public_metrics": {
        "retweet_count": 0,
        "retweet_count_str": "0",
        "reply_count": 0,
        "reply_count_str": "0",
        "like_count": 0,
        "like_count_str": "0",
        "quote_count": 0,
        "quote_count_str": "0",
        "bookmark_count": 0,
        "bookmark_count_str": "0",
        "impression_count": 0,
        "impression_count_str": "0"
      },
      "edit_controls": {
        "edits_remaining": 5,
        "edits_remaining_str": "5",
        "is_edit_eligible": true,
        "editable_until": "2026-07-07T14:17:01.000Z"
      },
      "text": "@mybot what time is it",
      "edit_history_tweet_ids": [
        "1900000000000000001"
      ],
      "in_reply_to_user_id": "222222222",
      "created_at": "2026-07-07T13:17:01.000Z"
    },
    "includes": {
      "users": [
        {
          "location": "",
          "created_at": "2007-08-21T05:11:32.000Z",
          "public_metrics": {
            "followers_count": 216,
            "followers_count_str": "216",
            "following_count": 12,
            "following_count_str": "12",
            "tweet_count": 23,
            "tweet_count_str": "23",
            "listed_count": 3,
            "listed_count_str": "3",
            "like_count": 9971,
            "like_count_str": "9971",
            "media_count": 4,
            "media_count_str": "4"
          },
          "username": "alt_account",
          "verified_type": "blue",
          "verified": true,
          "profile_image_url": "https://pbs.twimg.com/profile_images/0/default_normal.jpg",
          "protected": false,
          "is_identity_verified": false,
          "most_recent_tweet_id": "1900000000000000001",
          "id": "111111111",
          "description": "",
          "url": "",
          "name": "Alt Account",
          "pinned_tweet_id": "1900000000000000000"
        },
        {
          "created_at": "2022-11-10T23:37:51.000Z",
          "public_metrics": {
            "followers_count": 5855,
            "followers_count_str": "5855",
            "following_count": 999,
            "following_count_str": "999",
            "tweet_count": 1411,
            "tweet_count_str": "1411",
            "listed_count": 33,
            "listed_count_str": "33",
            "like_count": 7462,
            "like_count_str": "7462",
            "media_count": 81,
            "media_count_str": "81"
          },
          "username": "mybot",
          "verified_type": "blue",
          "verified": true,
          "profile_image_url": "https://pbs.twimg.com/profile_images/0/default_normal.jpg",
          "protected": false,
          "is_identity_verified": false,
          "most_recent_tweet_id": "1900000000000000001",
          "id": "222222222",
          "description": "",
          "url": "",
          "name": "My Bot",
          "pinned_tweet_id": "1900000000000000000"
        }
      ],
      "tweets": [
        {
          "id": "1900000000000000001",
          "conversation_id": "1900000000000000001",
          "entities": {
            "mentions": [
              {
                "start": 0,
                "start_str": "0",
                "end": 10,
                "end_str": "10",
                "username": "mybot",
                "id": "222222222"
              }
            ]
          },
          "author_id": "111111111",
          "paid_partnership": false,
          "possibly_sensitive": false,
          "lang": "en",
          "display_text_range": [
            0,
            26
          ],
          "reply_settings": "everyone",
          "public_metrics": {
            "retweet_count": 0,
            "retweet_count_str": "0",
            "reply_count": 0,
            "reply_count_str": "0",
            "like_count": 0,
            "like_count_str": "0",
            "quote_count": 0,
            "quote_count_str": "0",
            "bookmark_count": 0,
            "bookmark_count_str": "0",
            "impression_count": 0,
            "impression_count_str": "0"
          },
          "edit_controls": {
            "edits_remaining": 5,
            "edits_remaining_str": "5",
            "is_edit_eligible": true,
            "editable_until": "2026-07-07T14:17:01.000Z"
          },
          "text": "@mybot what time is it",
          "edit_history_tweet_ids": [
            "1900000000000000001"
          ],
          "in_reply_to_user_id": "222222222",
          "created_at": "2026-07-07T13:17:01.000Z"
        }
      ]
    }
  }
}
```

## create post (outbound, POST /2/tweets response)

Response body from posting a top-level tweet through the adapter's
`postChannelMessage("x:public", text)`. The created post id is under `data.id`.

```json
{
  "data": {
    "id": "1900000000000000002",
    "text": "this tweet was from chatsdk",
    "edit_history_tweet_ids": ["1900000000000000002"]
  }
}
```

## dm.received (inbound direct message)

Delivered when someone sends the authenticated account a DM. Unlike mentions,
DMs arrive in the **legacy Account Activity format**, a materially different
shape: the payload holds a `direct_message_events` array of `message_create`
items, the text lives at `message_create.message_data.text`, the sender is
`message_create.sender_id` and the recipient is
`message_create.target.recipient_id`, and hydrated users are in a `users`
**object keyed by id** (each under `.data`). Timestamps are epoch-millis
strings (`created_timestamp`). There is **no `dm_conversation_id`**, so the
adapter threads DMs by the other participant's user id (`x:dm:{userId}`).

```json
{
  "data": {
    "event_uuid": "1900000000000000009",
    "filter": {
      "user_id": "222222222"
    },
    "event_type": "dm.received",
    "tag": "chat-sdk-x-capture",
    "payload": {
      "direct_message_events": [
        {
          "type": "message_create",
          "id": "1900000000000000003",
          "created_timestamp": "1783430823813",
          "message_create": {
            "target": {
              "recipient_id": "222222222"
            },
            "sender_id": "111111111",
            "message_data": {
              "text": "hey from your alt",
              "entities": {
                "hashtags": [],
                "symbols": [],
                "user_mentions": [],
                "urls": []
              }
            }
          }
        }
      ],
      "users": {
        "111111111": {
          "data": {
            "url": "",
            "location": "",
            "protected": false,
            "created_at": "2007-08-21T05:11:32.000Z",
            "verified": true,
            "profile_image_url": "https://pbs.twimg.com/profile_images/0/default_normal.jpg",
            "verified_type": "blue",
            "name": "Alt Account",
            "username": "alt_account",
            "description": "",
            "public_metrics": {
              "followers_count": 216,
              "followers_count_str": "216",
              "following_count": 12,
              "following_count_str": "12",
              "tweet_count": 22,
              "tweet_count_str": "22",
              "listed_count": 3,
              "listed_count_str": "3",
              "like_count": 9971,
              "like_count_str": "9971",
              "media_count": 4,
              "media_count_str": "4"
            },
            "is_identity_verified": false,
            "id": "111111111"
          }
        },
        "222222222": {
          "data": {
            "url": "",
            "protected": false,
            "created_at": "2022-11-10T23:37:51.000Z",
            "verified": true,
            "profile_image_url": "https://pbs.twimg.com/profile_images/0/default_normal.jpg",
            "verified_type": "blue",
            "name": "My Bot",
            "username": "mybot",
            "description": "",
            "public_metrics": {
              "followers_count": 5855,
              "followers_count_str": "5855",
              "following_count": 999,
              "following_count_str": "999",
              "tweet_count": 1412,
              "tweet_count_str": "1412",
              "listed_count": 33,
              "listed_count_str": "33",
              "like_count": 7463,
              "like_count_str": "7463",
              "media_count": 81,
              "media_count_str": "81"
            },
            "is_identity_verified": false,
            "id": "222222222"
          }
        }
      }
    }
  }
}
```
