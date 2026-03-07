# message log

## Text message

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "000000000000000",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550000000",
              "phone_number_id": "000000000000000"
            },
            "contacts": [
              {
                "profile": { "name": "Test User" },
                "wa_id": "15551234567"
              }
            ],
            "messages": [
              {
                "from": "15551234567",
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAA",
                "timestamp": "1700000000",
                "text": { "body": "Hello, bot!" },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## Image message

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "000000000000000",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550000000",
              "phone_number_id": "000000000000000"
            },
            "contacts": [
              {
                "profile": { "name": "Test User" },
                "wa_id": "15551234567"
              }
            ],
            "messages": [
              {
                "from": "15551234567",
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAB",
                "timestamp": "1700000001",
                "type": "image",
                "image": {
                  "mime_type": "image/jpeg",
                  "sha256": "abc123def456",
                  "id": "000000000000001",
                  "caption": "Check this out"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## Reaction

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "000000000000000",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550000000",
              "phone_number_id": "000000000000000"
            },
            "contacts": [
              {
                "profile": { "name": "Test User" },
                "wa_id": "15551234567"
              }
            ],
            "messages": [
              {
                "from": "15551234567",
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAC",
                "timestamp": "1700000002",
                "type": "reaction",
                "reaction": {
                  "message_id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAA",
                  "emoji": "\ud83d\udc4d"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## Interactive button reply

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "000000000000000",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550000000",
              "phone_number_id": "000000000000000"
            },
            "contacts": [
              {
                "profile": { "name": "Test User" },
                "wa_id": "15551234567"
              }
            ],
            "messages": [
              {
                "context": {
                  "from": "15550000000",
                  "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAA"
                },
                "from": "15551234567",
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAD",
                "timestamp": "1700000003",
                "type": "interactive",
                "interactive": {
                  "type": "button_reply",
                  "button_reply": {
                    "id": "btn_approve",
                    "title": "Approve"
                  }
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## Status update (message delivered)

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "000000000000000",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550000000",
              "phone_number_id": "000000000000000"
            },
            "statuses": [
              {
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAA",
                "status": "delivered",
                "timestamp": "1700000004",
                "recipient_id": "15551234567",
                "conversation": {
                  "id": "CONVERSATION_ID",
                  "origin": { "type": "utility" }
                },
                "pricing": {
                  "billable": true,
                  "pricing_model": "CBP",
                  "category": "utility"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## Webhook verification handshake (GET)

```
GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=my_verify_token&hub.challenge=1158201444
```
