---
"chat": patch
---

Stop treating email addresses as bot mentions. A message containing `jane@acme.com` no longer triggers a bot named `acme`, because the `@` in `detectMention` must not follow a word character. Real mentions are unaffected, including at the start of a message, after punctuation, and suffixed names such as GitHub's `mybot[bot]`.
