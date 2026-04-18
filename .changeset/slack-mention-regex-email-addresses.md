---
"@chat-adapter/slack": patch
---

Fix `@mention` rewrite regex so email addresses (e.g. `user@example.com`) and `<mailto:…>` links are no longer mangled into broken Slack user mentions. The lookbehind now excludes any word character before `@`, which also means mentions immediately following a word character (e.g. `prefix@user`) are no longer rewritten — a bare `@user` still converts as before.
