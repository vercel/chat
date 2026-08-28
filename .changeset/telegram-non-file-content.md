---
"@chat-adapter/telegram": minor
---

Describe the message kinds Telegram sends with no text and no file. A shared location, venue, contact, poll, dice, game, invoice or story used to arrive as an empty message: the payload carried the content, but a handler reading `text` saw nothing. Each now gets a short literal description (`📍 55.75, 37.61`, `👤 Ada Lovelace +1555…`, `📊 Lunch or dinner?`), and the structured payload stays on the raw message for anyone who needs the numbers.
