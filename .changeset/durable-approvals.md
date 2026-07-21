---
"chat": minor
---

Add `chat/workflow` subpath with `requestApproval()` — durable human-in-the-loop approvals built on Workflow SDK. Posts an approval card with Approve/Deny buttons, suspends the workflow until a user decides (or an optional timeout elapses), validates approvers, finalizes the card with the outcome, and returns `{ approved, timedOut, user }`. Also exports the `buildApprovalCard`/`buildResolvedCard` builders. Requires the new optional `workflow` peer dependency.
