---
"chat": minor
"@chat-adapter/teams": minor
---

feat(teams): let a card carry a text input

`TextInput`, which modals already use, is now also a `CardChild`, so a user can type a reply on the card instead of opening a dialog. Teams renders it as an Adaptive Card `Input.Text` with the same mapping the modal converter uses, and the `@chat-adapter/teams/cards` subpath emits the same element. Slack, Google Chat, Discord, GitHub, and Linear show its label as text. WhatsApp, Messenger, Twilio, and X omit it, so don't make an input the only content on a card that reaches them.

`ActionEvent` gains `values?: Record<string, string>`, the card's own input values keyed by input ID. It has the same shape as `ModalSubmitEvent.values`. The Teams adapter fills it from the `Action.Submit` payload, and it is absent on platforms with no card inputs. A button's `callbackUrl` POST now carries `values` too, so a webhook-driven flow with no `onAction` handler still receives what was typed.

An input is required unless `optional` is set, and Teams validates every input on the card before it lets any button through, so mark it `optional` unless the buttons beside it should be blocked until it is filled. That validation is client-side, so treat `values` as user input and validate it in the handler.

`CardChild` gained a member, so an adapter outside this repo that exhausts the union with a `never` check needs a `text_input` case. Every in-repo converter reaches it through a `default:` branch instead, so none needed changing.
