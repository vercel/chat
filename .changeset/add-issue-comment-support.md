---
"@chat-adapter/github": minor
---

Add support for GitHub issue comments. The adapter now handles `issue_comment` webhooks on plain issues in addition to PRs. Issue threads use the format `github:owner/repo:issue:42`. All existing PR thread IDs remain backward compatible.
