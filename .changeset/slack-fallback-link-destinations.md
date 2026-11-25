---
"@chat-adapter/slack": patch
---

Preserve explicit Slack link destinations and labels in the incoming message AST when Markdown parsing limits are exceeded. This covers `<url|label>`, `<url>`, `mailto:` and `tel:` tokens, and the reversed `<label|url>` form. Keep the parsing limits and the plain-text display of well-formed tokens. Malformed link tokens, such as `<mailto:>` or `<http://a b|c>`, now render the same text as the Markdown parser. A `SlackFormatConverter` subclass that overrides `incomingFallbackText()` still gets its text in a single text node, without link nodes.

Decode entities in link destinations in plain-text attachment fields, and turn `mailto:` and `tel:` tokens in those fields into `link` nodes.
