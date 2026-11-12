---
"@chat-adapter/teams": patch
---

Messages read through Microsoft Graph (`fetchMessages`, `fetchChannelMessages`, and `listThreads`) now include images pasted into a Teams message as image attachments. `fetchData` downloads each one with the app's Graph token, which the adapter sends only to `hostedContents` URLs on Microsoft Graph hosts.
