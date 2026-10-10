---
"@chat-adapter/teams": patch
---

Make files shared in Teams group chats and channels downloadable from messages fetched through Microsoft Graph. Graph `reference` attachments now report a MIME type inferred from the file name and expose `fetchData()`, which resolves the SharePoint or OneDrive file through Graph.
