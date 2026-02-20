# Sample messages

```log
[chat-sdk:gchat] GChat webhook raw body {
  body: '{\n' +
    '  "commonEventObject": {\n' +
    '    "userLocale": "en",\n' +
    '    "hostApp": "CHAT",\n' +
    '    "platform": "WEB",\n' +
    '    "timeZone": {\n' +
    '      "id": "America/Los_Angeles",\n' +
    '      "offset": -2.88E7\n' +
    '    }\n' +
    '  },\n' +
    '  "authorizationEventObject": {\n' +
    '    "systemIdToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJodHRwczovL2V4YW1wbGUuY29tL2FwaS93ZWJob29rcy9nY2hhdCIsImV4cCI6MTc2NjQ2MjA0NiwiaWF0IjoxNzY2NDU4NDQ2LCJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ.fake-signature-for-testing"\n' +
    '  },\n' +
    '  "chat": {\n' +
    '    "user": {\n' +
    '      "name": "users/100000000000000000001",\n' +
    '      "displayName": "Test User",\n' +
    '      "avatarUrl": "https://lh3.googleusercontent.com/a/default-user=s64\\u003dk-no",\n' +
    '      "email": "testuser@example.com",\n' +
    '      "type": "HUMAN",\n' +
    '      "domainId": "12juw1z"\n' +
    '    },\n' +
    '    "eventTime": "2025-12-23T02:54:05.755455Z",\n' +
    '    "messagePayload": {\n' +
    '      "space": {\n' +
    '        "name": "spaces/AAQAJ9CXYcg",\n' +
    '        "type": "ROOM",\n' +
    '        "displayName": "Test Chat SDK",\n' +
    '        "spaceThreadingState": "THREADED_MESSAGES",\n' +
    '        "spaceType": "SPACE",\n' +
    '        "spaceHistoryState": "HISTORY_ON",\n' +
    '        "lastActiveTime": "2025-12-23T02:54:05.755455Z",\n' +
    '        "membershipCount": {\n' +
    '          "joinedDirectHumanUserCount": 1.0\n' +
    '        },\n' +
    '        "spaceUri": "https://chat.google.com/room/AAQAJ9CXYcg?cls\\u003d11"\n' +
    '      },\n' +
    '      "message": {\n' +
    '        "name": "spaces/AAQAJ9CXYcg/messages/FGEOaAwNIcs.FGEOaAwNIcs",\n' +
    '        "sender": {\n' +
    '          "name": "users/100000000000000000001",\n' +
    '          "displayName": "Test User",\n' +
    '          "avatarUrl": "https://lh3.googleusercontent.com/a/default-user=s64\\u003dk-no",\n' +
    '          "email": "testuser@example.com",\n' +
    '          "type": "HUMAN",\n' +
    '          "domainId": "12juw1z"\n' +
    '        },\n' +
    '        "createTime": "2025-12-23T02:54:05.755455Z",\n' +
    '        "text": "@Chat SDK Demo Hello",\n' +
    '        "annotations": [{\n' +
    '          "type": "USER_MENTION",\n' +
    '          "startIndex": 0.0,\n' +
    '          "length": 14.0,\n' +
    '          "userMention": {\n' +
    '            "user": {\n' +
    '              "name": "users/100000000000000000002",\n' +
    '              "displayName": "Chat SDK Demo",\n' +
    '              "avatarUrl": "https://lh6.googleusercontent.com/proxy/default-bot-avatar",\n' +
    '              "type": "BOT"\n' +
    '            },\n' +
    '            "type": "MENTION"\n' +
    '          }\n' +
    '        }],\n' +
    '        "thread": {\n' +
    '          "name": "spaces/AAQAJ9CXYcg/threads/FGEOaAwNIcs",\n' +
    '          "retentionSettings": {\n' +
    '            "state": "PERMANENT"\n' +
    '          }\n' +
    '        },\n' +
    '        "space": {\n' +
    '          "name": "spaces/AAQAJ9CXYcg",\n' +
    '          "type": "ROOM",\n' +
    '          "displayName": "Test Chat SDK",\n' +
    '          "spaceThreadingState": "THREADED_MESSAGES",\n' +
    '          "spaceType": "SPACE",\n' +
    '          "spaceHistoryState": "HISTORY_ON",\n' +
    '          "lastActiveTime": "2025-12-23T02:54:05.755455Z",\n' +
    '          "membershipCount": {\n' +
    '            "joinedDirectHumanUserCount": 1.0\n' +
    '          },\n' +
    '          "spaceUri": "https://chat.google.com/room/AAQAJ9CXYcg?cls\\u003d11"\n' +
    '        },\n' +
    '        "argumentText": " Hello",\n' +
    '        "retentionSettings": {\n' +
    '          "state": "PERMANENT"\n' +
    '        },\n' +
    '        "messageHistoryState": "HISTORY_ON",\n' +
    '        "formattedText": "@Chat SDK Demo Hello"\n' +
    '      },\n' +
    '      "configCompleteRedirectUri": "https://chat.google.com/api/bot_config_complete?token\u003dfake-config-token-for-testing"\n' +
    '    }\n' +
    '  }\n' +
    '}'
}
```

None, yet as we are still working on the pubsub
