---
"chat": minor
"@chat-adapter/teams": minor
---

feat(teams): let a card carry a text input

`TextInput` — the element modals already use — is now a `CardChild`, so a reply can be typed on the card instead of behind a dialog. Teams renders it as an Adaptive Card `Input.Text`, mapped exactly as the modal converter maps it, and the `@chat-adapter/teams/cards` subpath emits the same element. Slack, Google Chat, Discord, GitHub and Linear fall back to its label as text; WhatsApp, Messenger, Twilio and X omit it entirely, so do not make an input the only content on a card that reaches them.

`ActionEvent` gains `values?: Record<string, string>`, the card's own input values keyed by input ID — the same shape as `ModalSubmitEvent.values`. The Teams adapter fills it from the `Action.Submit` payload; it is absent on platforms with no card inputs. A button's `callbackUrl` POST now carries `values` too, so a webhook-driven flow with no `onAction` handler still receives what was typed.

An input is required unless `optional` is set, and Teams validates every input on the card before it lets any button through, so mark it `optional` unless the buttons beside it should be blocked until it is filled. That validation is client-side, so treat `values` as user input and validate it in the handler.

`CardChild` gained a member, so an adapter outside this repo that exhausts the union with a `never` check needs a `text_input` case. Every in-repo converter reaches it through a `default:` branch instead, so none needed changing.
