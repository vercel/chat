---
"@chat-adapter/slack": minor
"@chat-adapter/teams": minor
"chat": minor
---

Add `DateInput` and `NumberInput` modal children. The Slack adapter renders them as a `datepicker` and a `number_input`, the Teams adapter as `Input.Date` and `Input.Number`, and both submitted values arrive in `event.values` as strings.

Teams submit values that arrive as JSON numbers are now stringified into `event.values` instead of being dropped. This fixes `Input.Number`, but applies to any numeric value a Teams dialog submits — a key that was previously absent from `event.values` will now be present as a string.
