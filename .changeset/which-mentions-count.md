---
"chat": minor
"@chat-adapter/linear": patch
"@chat-adapter/notion": patch
"@chat-adapter/x": patch
"@chat-adapter/discord": patch
---

Honor an adapter's definitive `isMention: false` instead of re-detecting mentions from the message text.

An adapter that reads structured platform content reports `true` or `false`, and the SDK falls back to matching `@username` in the text only when the adapter reports nothing. A definitive `false` now wins, so an adapter can suppress a mention that exists only in text its platform renders literally, such as a code sample. Adapters that previously returned `false` to mean "not detected" should return `undefined` instead. Direct messages are unchanged: with no `onDirectMessage` handler registered they still route to `onNewMention`.

Adapter changes that follow from the new contract:

- Linear: ordinary comments are left undetermined, so SDK text detection still applies to them.
- Notion: `keyword` mode leaves comments without a keyword match undetermined instead of reporting `false`, so `@userName` in the text still counts.
- X: posts rebuilt from raw or fetched by id are left undetermined instead of reporting `false`. Only `post.mention.create` events report `true`.
- Discord: a real ping, role mention, `@everyone`, or allowlisted channel reports `true`; anything else is left undetermined instead of `false`, so a literal `@botname` typed in the text still counts as before.
