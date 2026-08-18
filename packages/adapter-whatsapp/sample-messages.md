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

## Text message with business-scoped user IDs

Username-enabled users carry a BSUID (`user_id`/`from_user_id`) and
optionally a parent BSUID. Phone-based fields (`from`, `wa_id`) are
omitted when the user has not shared their phone number.

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
                "profile": { "name": "Test User", "username": "testuser" },
                "wa_id": "15551234567",
                "user_id": "US.13491208655302741918",
                "parent_user_id": "US.ENT.11815799212886844830"
              }
            ],
            "messages": [
              {
                "from": "15551234567",
                "from_user_id": "US.13491208655302741918",
                "from_parent_user_id": "US.ENT.11815799212886844830",
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAB",
                "timestamp": "1700000000",
                "text": { "body": "Hello from a username user" },
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

## System message (user_changed_number)

Sent when a user changes their phone number. `from` carries the old
number; `system.wa_id` and `system.user_id` carry the new identifiers.

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
            "messages": [
              {
                "from": "15551234567",
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAC",
                "timestamp": "1700000001",
                "type": "system",
                "system": {
                  "body": "User Test User changed from 15551234567 to 15557654321",
                  "wa_id": "15557654321",
                  "user_id": "US.24817305912873645029",
                  "type": "user_changed_number"
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

## System message (user_changed_user_id)

Sent when a BSUID rotates. The system payload carries only the NEW
identifiers; `wa_id` is omitted when phone-number sharing conditions
are not met. The old-to-new mapping arrives separately via the
`user_id_update` webhook below.

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
            "messages": [
              {
                "id": "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUYwMDAwMDAwMDAwMDAwMDAD",
                "timestamp": "1700000002",
                "type": "system",
                "system": {
                  "body": "User Test User changed from US.13491208655302741918 to US.24817305912873645029",
                  "user_id": "US.24817305912873645029",
                  "type": "user_changed_user_id"
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

## BSUID rotation (user_id_update)

Delivered under `field: "user_id_update"` (a separate webhook
subscription field) when a phone number change regenerates a user's
BSUID. This is the payload that links the previous and current values.

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
                "wa_id": "15557654321"
              }
            ],
            "user_id_update": [
              {
                "wa_id": "15557654321",
                "detail": "User id for Test User has been updated.",
                "user_id": {
                  "previous": "US.13491208655302741918",
                  "current": "US.24817305912873645029"
                },
                "timestamp": "1700000003"
              }
            ]
          },
          "field": "user_id_update"
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
