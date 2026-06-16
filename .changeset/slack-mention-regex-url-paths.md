---
"@chat-adapter/slack": patch
---

Fix `@mention` rewrite regex so an `@handle` inside a URL path (e.g. `https://hackmd.io/@jkyang/abc`, `https://mastodon.social/@user`) is no longer rewritten into a `<@handle>` Slack mention, which corrupted the link. The lookbehind now also excludes a `/` immediately before `@`. Whitespace- and punctuation-led mentions (e.g. `(cc @george)`), emails, and `<mailto:…>` links are unaffected.
