---
"@chat-adapter/slack": patch
---

Fix `@mention` rewriting so an `@handle` inside a URL is no longer turned into a `<@handle>` Slack mention, which corrupted the link. Mention linking now skips whole `http(s)://…` spans, so handles in paths (`https://hackmd.io/@jkyang/abc`), query strings (`?user=@george`), and fragments (`#@george`) are preserved; the lookbehind also excludes a `/` immediately before `@` to cover schemeless URLs (`mastodon.social/@user`). Whitespace- and punctuation-led mentions (e.g. `(cc @george)`), emails, and `<mailto:…>` links are unaffected.
