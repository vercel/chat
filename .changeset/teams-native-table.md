---
"chat": minor
"@chat-adapter/teams": minor
---

feat(teams): render tables as the Adaptive Card 1.5 Table element

The Teams adapter now renders `Table` as the native Adaptive Cards `Table` element instead of a `Container` of `ColumnSet`s. Teams draws grid lines between cells, sizes columns by relative weight and marks the header row for accessibility. The `@chat-adapter/teams/cards` subpath emits the same element.

`Table` gains optional rendering options that only Teams reads: `widths` (positive integer column weights), `verticalAlign` (vertical alignment of cell content), `gridLines` (default `true`) and `gridStyle`. Other adapters ignore them. Pass `gridLines: false` to keep a borderless table.

The chat JSX runtime now forwards `align` on `<Table>`, matching `fromReactElement`.
