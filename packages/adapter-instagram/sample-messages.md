# Instagram messaging webhook samples

Captured payload shapes are sanitized. IDs, URLs, timestamps, and message
content are synthetic.

## Text DM

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998024000,
    "messaging": [{
      "sender": { "id": "200000000000001" },
      "recipient": { "id": "17841400000000000" },
      "timestamp": 1772998024000,
      "message": { "mid": "mid.text.1", "text": "Do you ship to Córdoba?" }
    }]
  }]
}
```

## Image attachment

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998034000,
    "messaging": [{
      "sender": { "id": "200000000000001" },
      "recipient": { "id": "17841400000000000" },
      "timestamp": 1772998034000,
      "message": {
        "mid": "mid.image.1",
        "attachments": [{
          "type": "image",
          "payload": { "url": "https://cdn.example.com/product.jpg" }
        }]
      }
    }]
  }]
}
```

## Story reply

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998044000,
    "messaging": [{
      "sender": { "id": "200000000000001" },
      "recipient": { "id": "17841400000000000" },
      "timestamp": 1772998044000,
      "message": {
        "mid": "mid.story.reply.1",
        "text": "Is this still available?",
        "reply_to": {
          "story": {
            "id": "17900000000000001",
            "url": "https://cdn.example.com/story.jpg"
          }
        }
      }
    }]
  }]
}
```

## Story mention

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998054000,
    "messaging": [{
      "sender": { "id": "200000000000001" },
      "recipient": { "id": "17841400000000000" },
      "timestamp": 1772998054000,
      "message": {
        "mid": "mid.story.mention.1",
        "attachments": [{
          "type": "story_mention",
          "payload": { "url": "https://cdn.example.com/mention.jpg" }
        }]
      }
    }]
  }]
}
```

## Quick reply

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998064000,
    "messaging": [{
      "sender": { "id": "200000000000001" },
      "recipient": { "id": "17841400000000000" },
      "timestamp": 1772998064000,
      "message": {
        "mid": "mid.quick.1",
        "text": "Yes",
        "quick_reply": { "payload": "chat:{\"a\":\"confirm\",\"v\":\"yes\"}" }
      }
    }]
  }]
}
```

## Postback

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998074000,
    "messaging": [{
      "sender": { "id": "200000000000001" },
      "recipient": { "id": "17841400000000000" },
      "timestamp": 1772998074000,
      "postback": {
        "mid": "mid.postback.1",
        "title": "Track order",
        "payload": "chat:{\"a\":\"track\"}"
      }
    }]
  }]
}
```

## Reaction

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998084000,
    "messaging": [{
      "sender": { "id": "200000000000001" },
      "recipient": { "id": "17841400000000000" },
      "timestamp": 1772998084000,
      "reaction": {
        "mid": "mid.sent.1",
        "action": "react",
        "emoji": "❤️"
      }
    }]
  }]
}
```

## Echo

```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841400000000000",
    "time": 1772998094000,
    "messaging": [{
      "sender": { "id": "17841400000000000" },
      "recipient": { "id": "200000000000001" },
      "timestamp": 1772998094000,
      "message": {
        "mid": "mid.echo.1",
        "text": "Your order is on the way.",
        "is_echo": true
      }
    }]
  }]
}
```
