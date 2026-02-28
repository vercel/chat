# iMessage Webhook Payload Examples

## Forwarded Gateway Event (DM)

POST to webhook with `x-imessage-gateway-token` header.

```json
{
  "type": "GATEWAY_NEW_MESSAGE",
  "timestamp": 1709136000000,
  "data": {
    "guid": "p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
    "text": "Hello!",
    "sender": "+1234567890",
    "senderName": "John Doe",
    "chatId": "iMessage;-;+1234567890",
    "isGroupChat": false,
    "isFromMe": false,
    "date": "2024-02-28T12:00:00.000Z",
    "attachments": [],
    "source": "remote"
  }
}
```

## Forwarded Gateway Event (Group Chat)

```json
{
  "type": "GATEWAY_NEW_MESSAGE",
  "timestamp": 1709136060000,
  "data": {
    "guid": "p:0/YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY",
    "text": "Hey everyone",
    "sender": "+1987654321",
    "senderName": null,
    "chatId": "iMessage;+;chat493787071395575843",
    "isGroupChat": true,
    "isFromMe": false,
    "date": "2024-02-28T12:01:00.000Z",
    "attachments": [],
    "source": "remote"
  }
}
```

## iMessage Kit (use local iMessage service)

Sent directly by the imessage-kit SDK when `webhook` config is set. Uses the same
`x-imessage-gateway-token` header.

```json
{
  "guid": "p:0/ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ",
  "text": "Check this out",
  "sender": "+1987654321",
  "senderName": "Jane Smith",
  "chatId": "iMessage;-;+1987654321",
  "isGroupChat": false,
  "isFromMe": false,
  "isReaction": false,
  "service": "iMessage",
  "date": "2024-02-28T12:02:00.000Z",
  "attachments": [
    {
      "id": "att-001",
      "filename": "photo.jpg",
      "mimeType": "image/jpeg",
      "size": 12345,
      "path": "/tmp/Attachments/photo.jpg",
      "isImage": true,
      "createdAt": "2024-02-28T12:02:00.000Z"
    }
  ]
}
```

## Advanced iMessage Kit (use [Photon](https://photon.codes) iMessage service)

Raw message from `AdvancedIMessageKit` `new-message` event:

```json
{
  "guid": "p:0/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
  "text": "Hello from remote!",
  "isFromMe": false,
  "dateCreated": 1709136180000,
  "handle": {
    "address": "+1234567890"
  },
  "chats": [
    {
      "guid": "iMessage;-;+1234567890",
      "style": 43
    }
  ],
  "attachments": []
}
```

## Chat GUID Patterns

- DM: `iMessage;-;+1234567890` (`;-;` = direct message)
- Group: `iMessage;+;chat493787071395575843` (`;+;` = group chat)
- SMS DM: `SMS;-;+1234567890`
- SMS Group: `SMS;+;chat987654321`
