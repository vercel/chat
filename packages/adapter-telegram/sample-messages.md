# Sample messages

## Photo message

Sanitized from a [captured Telegram webhook](https://gist.github.com/otnansirk/759ef10ad21aa889810c8af7cbcd03bc).

```json
{
  "update_id": 312744884,
  "message": {
    "message_id": 17,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1753164384,
    "photo": [
      {
        "file_id": "AgACAgUAAxkBAAMRaH8qXw-VQSGAG4X4VoCg9A5nE50AAvLGMRtBGPlXGt4-FX4l2_oBAAMCAANzAAM2BA",
        "file_unique_id": "AQAD8sYxG0EY-Vd4",
        "file_size": 1705,
        "width": 72,
        "height": 90
      },
      {
        "file_id": "AgACAgUAAxkBAAMRaH8qXw-VQSGAG4X4VoCg9A5nE50AAvLGMRtBGPlXGt4-FX4l2_oBAAMCAANtAAM2BA",
        "file_unique_id": "AQAD8sYxG0EY-Vdy",
        "file_size": 32527,
        "width": 255,
        "height": 320
      },
      {
        "file_id": "AgACAgUAAxkBAAMRaH8qXw-VQSGAG4X4VoCg9A5nE50AAvLGMRtBGPlXGt4-FX4l2_oBAAMCAAN4AAM2BA",
        "file_unique_id": "AQAD8sYxG0EY-Vd9",
        "file_size": 137906,
        "width": 638,
        "height": 800
      },
      {
        "file_id": "AgACAgUAAxkBAAMRaH8qXw-VQSGAG4X4VoCg9A5nE50AAvLGMRtBGPlXGt4-FX4l2_oBAAMCAAN5AAM2BA",
        "file_unique_id": "AQAD8sYxG0EY-Vd-",
        "file_size": 173215,
        "width": 816,
        "height": 1023
      }
    ]
  }
}
```

## Sticker message

Sanitized sticker update, shape per the
[Bot API `Sticker` object](https://core.telegram.org/bots/api#sticker). The
message carries no `text`; `emoji` and `set_name` are both optional, so a
parser must not rely on either. A still sticker is WebP; `is_video` marks a
WebM one and `is_animated` a Lottie (TGS) one.

```json
{
  "update_id": 312744887,
  "message": {
    "message_id": 321,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290120,
    "sticker": {
      "file_id": "CAACAgIAAxkBAAIBQWjPMV5rZ0dEUvO0kQABt3l0aFYyAAJKAANZu_wlnFJ1RE9WuJk2BA",
      "file_unique_id": "AgADSgADWbv8JQ",
      "type": "regular",
      "width": 512,
      "height": 512,
      "is_animated": false,
      "is_video": false,
      "emoji": "😀",
      "set_name": "TestPack",
      "thumbnail": {
        "file_id": "AAMCAgADGQEAAgFBaM8xXmtnR0RS87SRAAG3eXRoVjIAAkoAA1m7_CWcUnVET1a4mQEAB20AAzYE",
        "file_unique_id": "AQADSgADWbv8JXI",
        "file_size": 5304,
        "width": 128,
        "height": 128
      },
      "file_size": 36042
    }
  }
}
```

## Animation (GIF) message

Sanitized animation update, shape per the
[Bot API `Message.animation` field](https://core.telegram.org/bots/api#message):
"For backward compatibility, when this field is set, the *document* field will
also be set." Both fields describe the same file (same `file_id`), so a parser
that walks both produces a duplicate attachment.

```json
{
  "update_id": 312744888,
  "message": {
    "message_id": 322,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290180,
    "animation": {
      "file_id": "CgACAgQAAxkBAAIBQmjPMbXhH2m0T3nQAAFrJ8x0aFYyAAK0AgACWbv8U5FQn0lmQnUsNgQ",
      "file_unique_id": "AgADtAIAAlm7_FM",
      "file_name": "cat.mp4",
      "mime_type": "video/mp4",
      "duration": 3,
      "width": 480,
      "height": 480,
      "thumbnail": {
        "file_id": "AAMCBAADGQEAAgFCaM8xteEfabRPedAAAWsnzHRoVjIAArQCAAJZu_xTkVCfSWZCdSwBAAdtAAM2BA",
        "file_unique_id": "AQADtAIAAlm7_FNy",
        "file_size": 12816,
        "width": 320,
        "height": 320
      },
      "file_size": 291345
    },
    "document": {
      "file_id": "CgACAgQAAxkBAAIBQmjPMbXhH2m0T3nQAAFrJ8x0aFYyAAK0AgACWbv8U5FQn0lmQnUsNgQ",
      "file_unique_id": "AgADtAIAAlm7_FM",
      "file_name": "cat.mp4",
      "mime_type": "video/mp4",
      "thumbnail": {
        "file_id": "AAMCBAADGQEAAgFCaM8xteEfabRPedAAAWsnzHRoVjIAArQCAAJZu_xTkVCfSWZCdSwBAAdtAAM2BA",
        "file_unique_id": "AQADtAIAAlm7_FNy",
        "file_size": 12816,
        "width": 320,
        "height": 320
      },
      "file_size": 291345
    }
  }
}
```

## Reply to a bot message in a group

Sanitized from a captured webhook: a user replies to one of the bot's own
messages in a supergroup. `reply_to_message.from` is the bot account. With
`mentionOnReply` enabled this counts as a mention.

```json
{
  "update_id": 312744885,
  "message": {
    "message_id": 108,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": -1001000000001,
      "title": "Test Group",
      "type": "supergroup"
    },
    "date": 1756290000,
    "reply_to_message": {
      "message_id": 105,
      "from": {
        "id": 8000000001,
        "is_bot": true,
        "first_name": "Test Bot",
        "username": "testbot"
      },
      "chat": {
        "id": -1001000000001,
        "title": "Test Group",
        "type": "supergroup"
      },
      "date": 1756289940,
      "text": "The first option is usually the safer choice."
    },
    "text": "and the second one?"
  }
}
```

## Forum topic message with an implicit reply

Sanitized from a captured webhook in a forum supergroup. Every message posted
inside a topic carries `reply_to_message` pointing at the topic-creation
service message, whose `message_id` equals `message_thread_id` and whose
`from` is whoever created the topic (the bot, when it called
`createForumTopic`). This is not an explicit reply and must not count as a
mention under `mentionOnReply`.

```json
{
  "update_id": 312744886,
  "message": {
    "message_id": 214,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": -1001000000002,
      "title": "Test Forum",
      "type": "supergroup",
      "is_forum": true
    },
    "date": 1756290060,
    "message_thread_id": 200,
    "is_topic_message": true,
    "reply_to_message": {
      "message_id": 200,
      "from": {
        "id": 8000000001,
        "is_bot": true,
        "first_name": "Test Bot",
        "username": "testbot"
      },
      "chat": {
        "id": -1001000000002,
        "title": "Test Forum",
        "type": "supergroup",
        "is_forum": true
      },
      "date": 1756289000,
      "message_thread_id": 200,
      "is_topic_message": true,
      "forum_topic_created": {
        "name": "Support",
        "icon_color": 7322096
      }
    },
    "text": "does anyone know how to configure this?"
  }
}
```

## Location message

Sanitized location update, shape per the
[Bot API `Message.location` field](https://core.telegram.org/bots/api#message).
No `text`, no file — the coordinates are the whole message.

```json
{
  "update_id": 312744889,
  "message": {
    "message_id": 323,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290240,
    "location": {
      "latitude": 52.520008,
      "longitude": 13.404954,
      "horizontal_accuracy": 14.2
    }
  }
}
```

## Venue message

Sanitized venue update, shape per the
[Bot API `Message.venue` field](https://core.telegram.org/bots/api#message):
"For backward compatibility, when this field is set, the *location* field will
also be set." A parser that checks `location` before `venue` therefore renders
every venue as bare coordinates.

```json
{
  "update_id": 312744890,
  "message": {
    "message_id": 324,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290300,
    "location": {
      "latitude": 52.516275,
      "longitude": 13.377704
    },
    "venue": {
      "location": {
        "latitude": 52.516275,
        "longitude": 13.377704
      },
      "title": "Brandenburg Gate",
      "address": "Pariser Platz, 10117 Berlin",
      "foursquare_id": "4adcda10f964a520af3521e3",
      "foursquare_type": "arts_entertainment/monument"
    }
  }
}
```

## Contact message

Sanitized contact update, shape per the
[Bot API `Contact` object](https://core.telegram.org/bots/api#contact).
`last_name`, `user_id`, and `vcard` are all optional — this capture has no
`last_name`, so a parser must not rely on it.

```json
{
  "update_id": 312744891,
  "message": {
    "message_id": 325,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290360,
    "contact": {
      "phone_number": "+15550100123",
      "first_name": "Ada",
      "user_id": 100000002
    }
  }
}
```

## Poll message

Sanitized poll update, shape per the
[Bot API `Poll` object](https://core.telegram.org/bots/api#poll). The question
and options live on the poll; there is no `text`.

```json
{
  "update_id": 312744892,
  "message": {
    "message_id": 326,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": -1001000000001,
      "title": "Test Group",
      "type": "supergroup"
    },
    "date": 1756290420,
    "poll": {
      "id": "5312345678901234567",
      "question": "Lunch or dinner?",
      "options": [
        { "text": "Lunch", "voter_count": 3 },
        { "text": "Dinner", "voter_count": 5 }
      ],
      "total_voter_count": 8,
      "is_closed": false,
      "is_anonymous": true,
      "type": "regular",
      "allows_multiple_answers": false
    }
  }
}
```

## Dice message

Sanitized dice update, shape per the
[Bot API `Dice` object](https://core.telegram.org/bots/api#dice). The `emoji`
varies (🎲, 🎯, 🏀, ⚽, 🎳, 🎰) and `value` is the rolled result.

```json
{
  "update_id": 312744893,
  "message": {
    "message_id": 327,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290480,
    "dice": {
      "emoji": "🎲",
      "value": 4
    }
  }
}
```

## Game message

Sanitized game update, shape per the
[Bot API `Game` object](https://core.telegram.org/bots/api#game). Sent when a
bot shares a game; `photo` is always present on real payloads.

```json
{
  "update_id": 312744894,
  "message": {
    "message_id": 328,
    "from": {
      "id": 8000000001,
      "is_bot": true,
      "first_name": "Test Bot",
      "username": "testbot"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290540,
    "game": {
      "title": "Corsairs",
      "description": "Sail, trade and plunder.",
      "photo": [
        {
          "file_id": "AgACAgIAAxkDAAIBRGjPMnH9YQnJ0aTgVFCk0aFYyAAJLAANZu_wlnFJ1RE9WuJk2BA",
          "file_unique_id": "AQADSwADWbv8JXI",
          "file_size": 42817,
          "width": 640,
          "height": 360
        }
      ]
    }
  }
}
```

## Invoice message

Sanitized invoice update, shape per the
[Bot API `Invoice` object](https://core.telegram.org/bots/api#invoice).
`total_amount` is in the currency's smallest unit and the exponent varies per
currency ([currencies.json](https://core.telegram.org/bots/payments/currencies.json)):
this 5000 is 50.00 USD, but 5000 JPY would be 5000 yen and 5000 BHD units
would be 5.000 dinar. XTR (Telegram Stars) counts whole Stars.

```json
{
  "update_id": 312744895,
  "message": {
    "message_id": 329,
    "from": {
      "id": 8000000001,
      "is_bot": true,
      "first_name": "Test Bot",
      "username": "testbot"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290600,
    "invoice": {
      "title": "Yearly plan",
      "description": "12 months of hosted service",
      "start_parameter": "yearly-plan",
      "currency": "USD",
      "total_amount": 5000
    }
  }
}
```

## Story message

Sanitized story share, shape per the
[Bot API `Message.story` field](https://core.telegram.org/bots/api#message).
The story content itself is not exposed to bots — only the originating chat
and the story id.

```json
{
  "update_id": 312744896,
  "message": {
    "message_id": 330,
    "from": {
      "id": 100000001,
      "is_bot": false,
      "first_name": "Test User",
      "username": "testuser",
      "language_code": "en"
    },
    "chat": {
      "id": 100000001,
      "first_name": "Test User",
      "username": "testuser",
      "type": "private"
    },
    "date": 1756290660,
    "story": {
      "chat": {
        "id": 100000003,
        "first_name": "Story Author",
        "username": "storyauthor",
        "type": "private"
      },
      "id": 7
    }
  }
}
```
