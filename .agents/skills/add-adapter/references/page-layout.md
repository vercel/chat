# Adapter page layout

Every page under `apps/docs/content/adapters/` follows the same section order and names, so readers find the same information in the same place on every adapter. Start from [../assets/adapter.mdx](../assets/adapter.mdx) for a platform adapter or [../assets/adapter-state.mdx](../assets/adapter-state.mdx) for a state adapter, and use this file to decide which optional sections the adapter needs.

The page header already renders the frontmatter `title` and `tagline`, so don't open the body with an intro paragraph that repeats them. The first section is always `## Install`.

## Platform adapters (`type: platform`)

Use these sections in this order. Leave out an optional section when the adapter has nothing to put in it.

| Section | Required | Contents |
| --- | --- | --- |
| `## Install` | Yes | `<PackageInstall package="..." />` only |
| `## Quick start` | Yes | A copy-pasteable `lib/bot.ts` (with `export const bot` and `state: createMemoryState()`), one sentence on production state, then the webhook route in `app/api/webhooks/<slug>/route.ts` |
| `## Platform setup` | Optional | Numbered steps in the vendor's console or dashboard: create the app, copy credentials, register the webhook URL |
| `## Authentication` | Optional | Only when there is more than one credential mode. One `###` per mode, named after the mode (`### Vercel Connect`, `### Bot token`, `### OAuth`). Vercel Connect, when supported, comes first |
| `## Configuration` | Yes | A `<TypeTable>` of factory options |
| `### Environment variables` | When the adapter reads any | A table with `Variable`, `Required`, and `Description` columns, under Configuration |
| `## Webhooks` | Optional | Event subscriptions, signature verification, and route options such as `waitUntil` |
| Capability sections | As needed | One `##` per platform-specific capability, such as `## Cards`, `## Streaming`, `## Attachments`, `## Reactions`, `## Message history`. Put the most commonly needed first |
| `## Thread IDs` | Recommended | The thread ID format and an example |
| `## Limitations` | Optional | Caveats and unsupported behavior |
| `## Troubleshooting` | Optional | `###` per symptom |
| `## Feature support` | Yes | `<FeatureSupport />` (the tests require it) |
| `## Resources` | Optional | Always last. Source repo, vendor docs, example apps |

## State adapters (`type: state`)

`## Install` → `## Quick start` → `## Configuration` (with `### Environment variables`) → `## Using an existing client` (optional) → `## Data model` (optional) → capability sections such as sharding, cleanup, or locking → `## Production notes` (optional) → `## Limitations` (optional) → `## Feature support` → `## Resources` (optional).

## Naming

Use these names, not the variants on the right:

| Use | Instead of |
| --- | --- |
| `## Platform setup` | Setup, App setup, Connection setup, "Creating a Foo app" |
| `## Webhooks` | Webhook setup, Webhook route, Webhook events |
| `## Thread IDs` | Thread ID format, ID encoding, Threads |
| `## Limitations` | Notes, Known limitations, Behavior notes, Design notes |
| `## Resources` | Links, Learn more, Examples |
| `## Data model` | Key structure, What is stored |
| `### Vercel Connect` | "Option A — Vercel Connect" |

Don't add a catch-all `## Advanced` section. Give each topic its own named section and place it by the table above. Don't add marketing sections such as "Why Foo" or "How it works"; put the concrete facts in the section they belong to.

## Frontmatter prose

`tagline` and `description` render in the page header, the adapter listing, and search results. Describe what the adapter connects to and what it supports, without hype such as "seamless", "powerful", or "out of the box". For vendor-official adapters, `description` must match the `@chat-adapter/catalog` entry exactly.

## Writing

Load the `technical-writer` skill before writing any of this. Take every fact, option name, and code sample from the adapter's README and source, as the sourcing rules in [../SKILL.md](../SKILL.md) require.
