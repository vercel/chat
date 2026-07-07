---
"create-chat-sdk": minor
---

Add Vercel Connect support to the scaffolder. Pass `--connect` (or choose **Vercel Connect** at the new interactive auth-mode prompt) to authenticate the Slack, GitHub, and Linear adapters with a Vercel Connect connector instead of stored provider secrets. The generated `src/lib/bot.ts` spreads the matching helper from `@vercel/connect/chat` into the adapter factory, `@vercel/connect` is added to dependencies, and `.env.example` lists each connector UID (for example `SLACK_CONNECTOR`) plus the recommended `GITHUB_BOT_USER_ID` for GitHub, in place of native secrets.
