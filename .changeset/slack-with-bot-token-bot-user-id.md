---
"@chat-adapter/slack": minor
---

`withBotToken` accepts an optional `botUserId`, so a multi-workspace adapter can recognize the bot's own messages outside webhook handling. A multi-workspace adapter has no fixed bot user ID, and `withBotToken` previously stored only the token and `installationId`. Inside the callback, `adapter.botUserId` was `undefined`, and messages the bot had posted, such as those returned by `fetchMessages`, had `author.isMe` set to `false`. Pass the installation's `botUserId` from `getInstallation`:

```ts
const install = await slackAdapter.getInstallation(teamId);
if (!install) throw new Error("Workspace not installed");

await slackAdapter.withBotToken(install.botToken, fn, {
  installationId: teamId,
  botUserId: install.botUserId,
});
```
