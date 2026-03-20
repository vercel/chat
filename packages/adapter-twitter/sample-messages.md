# Twitter / X Sample Messages

## Direct Message Webhook Payload

This is what a standard payload looks like when a user sends a Direct Message to the bot, as delivered by the Account Activity API.

```json
{
  "for_user_id": "987654321",
  "direct_message_events": [
    {
      "type": "message_create",
      "id": "1638290192839218391",
      "created_timestamp": "1679354012000",
      "message_create": {
        "target": {
          "recipient_id": "987654321"
        },
        "sender_id": "123456789",
        "message_data": {
          "text": "Hello Twitter bot!",
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
    "123456789": {
      "id": "123456789",
      "created_timestamp": "1422556069340",
      "name": "Alex Developer",
      "screen_name": "alexdev",
      "protected": false,
      "verified": true,
      "followers_count": 1500,
      "friends_count": 800,
      "statuses_count": 5200,
      "profile_image_url_https": "https://pbs.twimg.com/profile_images/123/avatar.jpg"
    },
    "987654321": {
      "id": "987654321",
      "created_timestamp": "1512340000000",
      "name": "Cool Bot",
      "screen_name": "cool_bot_123",
      "protected": false,
      "verified": false,
      "followers_count": 50,
      "friends_count": 2,
      "statuses_count": 15,
      "profile_image_url_https": "https://pbs.twimg.com/profile_images/456/bot.jpg"
    }
  }
}
```

## Challenge-Response Check (CRC) Request

Twitter sporadically issues GET requests to verify webhook ownership. The URL will look like:

```text
GET https://your-domain.com/api/webhooks/twitter?crc_token=1CDehg9...
```

The adapter computes the HMAC-SHA256 of `1CDehg9...` using the `TWITTER_CONSUMER_SECRET` and responds with:

```json
{
  "response_token": "sha256=MzA3O..."
}
```

## Direct Message with Media Attachment

When a user attaches an image or video to a DM.

```json
{
  "for_user_id": "987654321",
  "direct_message_events": [
    {
      "type": "message_create",
      "id": "1638290192839218392",
      "created_timestamp": "1679354055000",
      "message_create": {
        "target": {
          "recipient_id": "987654321"
        },
        "sender_id": "123456789",
        "message_data": {
          "text": "Check out this screenshot https://t.co/abc123def",
          "entities": {
            "hashtags": [],
            "symbols": [],
            "user_mentions": [],
            "urls": [
              {
                "url": "https://t.co/abc123def",
                "expanded_url": "...",
                "display_url": "pic.twitter.com/xyz",
                "indices": [24, 46]
              }
            ]
          },
          "attachment": {
            "type": "media",
            "media": {
              "id": 16382901500000000,
              "id_str": "1638290150000000000",
              "media_url": "http://pbs.twimg.com/media/FxsX_Y_WYAETZ...jpg",
              "media_url_https": "https://pbs.twimg.com/media/FxsX_Y_WYAETZ...jpg",
              "url": "https://t.co/abc123def",
              "display_url": "pic.twitter.com/xyz",
              "expanded_url": "https://twitter.com/messages/media/1638290150000000000",
              "type": "photo",
              "sizes": {
                "medium": { "w": 1200, "h": 675, "resize": "fit" },
                "thumb": { "w": 150, "h": 150, "resize": "crop" },
                "small": { "w": 680, "h": 383, "resize": "fit" },
                "large": { "w": 1920, "h": 1080, "resize": "fit" }
              }
            }
          }
        }
      }
    }
  ],
  "users": {
    "123456789": {
       "id": "123456789",
       "name": "Alex Developer",
       "screen_name": "alexdev"
    }
  }
}
```
