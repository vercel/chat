---
name: Add LinkButton Component
overview: Add a new LinkButton component with a separate LinkButtonElement AST type (type "link-button") for buttons that open URLs. All four platforms natively support this feature with distinct implementations.
todos:
  - id: core-types
    content: Add LinkButtonElement interface and LinkButton() function in packages/chat/src/cards.ts
    status: completed
  - id: actions-element
    content: Update ActionsElement to accept both ButtonElement and LinkButtonElement
    status: completed
  - id: jsx-runtime
    content: Add LinkButton component and LinkButtonProps in packages/chat/src/jsx-runtime.ts
    status: completed
  - id: exports
    content: Export LinkButton and related types from packages/chat/src/index.ts
    status: completed
  - id: slack-adapter
    content: Handle link-button type in packages/adapter-slack/src/cards.ts
    status: completed
  - id: discord-adapter
    content: Handle link-button type in packages/adapter-discord/src/cards.ts using ButtonStyle.Link
    status: completed
  - id: teams-adapter
    content: Handle link-button type in packages/adapter-teams/src/cards.ts using Action.OpenUrl
    status: completed
  - id: gchat-adapter
    content: Handle link-button type in packages/adapter-gchat/src/cards.ts using openLink
    status: completed
  - id: core-tests
    content: Add LinkButton tests to packages/chat/src/cards.test.ts
    status: completed
  - id: jsx-tests
    content: Add LinkButton JSX tests to packages/chat/src/jsx-runtime.test.ts and jsx-runtime.test.tsx
    status: completed
  - id: slack-tests
    content: Add link button conversion tests to packages/adapter-slack/src/cards.test.ts
    status: completed
  - id: discord-tests
    content: Add link button conversion tests to packages/adapter-discord/src/cards.test.ts
    status: completed
  - id: teams-tests
    content: Add link button conversion tests to packages/adapter-teams/src/cards.test.ts
    status: completed
  - id: gchat-tests
    content: Add link button conversion tests to packages/adapter-gchat/src/cards.test.ts
    status: completed
  - id: readme
    content: Update README.md Rich Cards section to document LinkButton
    status: completed
isProject: false
---

# Add LinkButton Component

## Rationale

A separate `LinkButton` component (rather than polymorphic `Button`) because:

- 3/4 platforms treat link buttons as fundamentally different (Discord, Teams,

GChat)

- Avoids nested discriminated unions
- Cleaner pattern matching in adapters: `case "link-button":`
- Easier test assertions: `expect(element.type).toBe("link-button")`

## New Types

Add to [packages/chat/src/cards.ts](packages/chat/src/cards.ts):

```ts
export interface LinkButtonElement {
  type: "link-button";
  url: string;
  label: string;
  style?: ButtonStyle;
}

export interface LinkButtonOptions {
  url: string;
  label: string;
  style?: ButtonStyle;
}

export function LinkButton(options: LinkButtonOptions): LinkButtonElement;
```

## Updated ActionsElement

```ts
export interface ActionsElement {
  type: "actions";
  children: (ButtonElement | LinkButtonElement)[];
}
```

## JSX Usage

```tsx
import { Button, LinkButton, Actions, Card } from "chat";
<Card>
  <Actions>
    <Button id="approve" style="primary">
      Approve
    </Button>
    <LinkButton url="https://docs.example.com" style="primary">
      View Docs
    </LinkButton>
  </Actions>
</Card>;
```

## Files to Modify

### Core Package

1. **[packages/chat/src/cards.ts](packages/chat/src/cards.ts)**

- Add `LinkButtonElement` interface (after `ButtonElement`)
- Add `LinkButtonOptions` interface (after `ButtonOptions`)
- Add `LinkButton()` function (after `Button()`)
- Update `ActionsElement.children` type to

`(ButtonElement | LinkButtonElement)[]`

- Update `AnyCardElement` union to include `LinkButtonElement`
- Add `LinkButton` to debug name map

1. **[packages/chat/src/jsx-runtime.ts](packages/chat/src/jsx-runtime.ts)**

- Add `LinkButtonProps` interface
- Add `LinkButton` to component type union
- Add `isLinkButtonProps` type guard
- Handle `LinkButton` in `toCardElement`
- Export `LinkButton` and `LinkButtonProps`

2. **[packages/chat/src/index.ts](packages/chat/src/index.ts)**

- Export `LinkButton` function
- Export `LinkButtonElement`, `LinkButtonOptions` types
- Export `LinkButtonProps` from jsx-runtime

### Adapters

1. **[packages/adapter-slack/src/cards.ts](packages/adapter-slack/src/cards.ts)**

- Import `LinkButtonElement` from chat
- Update `convertActionsToBlock` to handle both button types
- Add `convertLinkButtonToElement` that sets `url` property

2. **[packages/adapter-discord/src/cards.ts](packages/adapter-discord/src/cards.ts)**

- Import `LinkButtonElement` from chat
- Update `convertActionsElement` to handle both button types
- Add `convertLinkButtonElement` using `ButtonStyle.Link` (5) with `url` (no

`custom_id`)

1. **[packages/adapter-teams/src/cards.ts](packages/adapter-teams/src/cards.ts)**

- Import `LinkButtonElement` from chat
- Update `convertActionsToElements` to handle both button types
- Add `convertLinkButtonToAction` using `Action.OpenUrl` with `url`

2. **[packages/adapter-gchat/src/cards.ts](packages/adapter-gchat/src/cards.ts)**

- Import `LinkButtonElement` from chat
- Update `convertActionsToWidget` to handle both button types
- Add `convertLinkButtonToGoogleButton` using `openLink: { url }` in onClick

### Tests

1. **[packages/chat/src/cards.test.ts](packages/chat/src/cards.test.ts)**

- Add `describe("LinkButton")` block with tests for:
  - Creates a link button element
  - Creates a styled link button

2. **[packages/chat/src/jsx-runtime.test.ts](packages/chat/src/jsx-runtime.test.ts)**

- Add test for `jsx(LinkButton, { url, children })`

3. **[packages/chat/src/jsx-runtime.test.tsx](packages/chat/src/jsx-runtime.test.tsx)**

- Add test for `<LinkButton url="...">Label</LinkButton>` in Actions

4. **[packages/adapter-slack/src/cards.test.ts](packages/adapter-slack/src/cards.test.ts)**

- Add test: "converts link buttons with url property"

5. **[packages/adapter-discord/src/cards.test.ts](packages/adapter-discord/src/cards.test.ts)**

- Add test: "converts link buttons using Link style"

6. **[packages/adapter-teams/src/cards.test.ts](packages/adapter-teams/src/cards.test.ts)**

- Add test: "converts link buttons to Action.OpenUrl"

7. **[packages/adapter-gchat/src/cards.test.ts](packages/adapter-gchat/src/cards.test.ts)**

- Add test: "converts link buttons with openLink"

### Documentation

1. **[README.md](README.md)**

- Add `LinkButton` to import in "Rich Cards with Buttons" section
  - Add example showing LinkButton usage alongside Button

## Platform-Specific Output

| Platform | Link Button Output |

|----------|-------------------|

| Slack | `{ type: "button", url: "...", action_id: "link", text: {...} }` |

| Discord | `{ type: 2, style: 5, url: "...", label: "..." }` (no custom_id) |

| Teams | `{ type: "Action.OpenUrl", title: "...", url: "..." }` |

| GChat | `{ text: "...", onClick: { openLink: { url: "..." } } }` |

## Code Style Notes

- Follow existing patterns: no gratuitous comments
- JSDoc only on public exports (interfaces, functions)
- Tests: clean describe/it blocks, no comments
- Match existing formatting (single quotes in code, etc.)
