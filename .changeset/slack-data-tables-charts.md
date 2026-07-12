---
"chat": minor
"@chat-adapter/slack": minor
---

Add chart support and richer table rendering, with native Slack data table and data visualization blocks.

- New core `ChartElement` and `Chart()` builder (JSX supported) with pie, bar, area, and line charts, mirroring Slack's data visualization model: pie charts take `segments`, series charts take named `series` plotted against shared `categories` with optional `xLabel`/`yLabel`.
- `TableElement` / `Table()` gain optional `caption` (accessible table description) and `pageSize` (rows per page) fields.
- Charts degrade gracefully on platforms without native chart support: the underlying data renders as a text table via the shared card fallback (new `chartElementToFallbackText` helper).
- Slack adapter: card tables now render as [data table blocks](https://docs.slack.dev/reference/block-kit/blocks/data-table-block) by default — paginated and sortable — instead of plain table blocks. Header-only tables keep the plain table block; tables exceeding Slack limits (100 data rows, 20 columns, 10,000 characters) fall back to ASCII as before.
- Slack adapter: card charts render as [data visualization blocks](https://docs.slack.dev/reference/block-kit/blocks/data-visualization-block). Charts violating Slack constraints (50-character title, 12 segments/series, 20 categories, 20-character labels, one data point per category, max 2 charts per message) fall back to a text rendering instead of being rejected by the API.
- The `@chat-adapter/slack/blocks` subpath gets the same treatment: `SlackChartElement` types, `chart` card children, data table rendering, and matching limits.
- `postMessage` now surfaces Slack's per-block validation details when the API rejects blocks (`invalid_blocks`), instead of the bare "An API error occurred" message.
