# Geistdocs agent instructions

This app (chat-sdk.dev) uses the packaged Geistdocs architecture. The `@vercel/geistdocs` package owns shared runtime behavior; this app owns local content, configuration, adapters, and site-specific routes.

Use these instructions when an AI coding agent edits this app.

## Architecture

- Runtime features come from `@vercel/geistdocs`, including the docs page renderer, layout helpers, MDX components, search, Ask AI, markdown routes, proxy helpers, and source helpers.
- `@vercel/geistdocs` owns the Ask AI client, server route behavior, and AI SDK v6 runtime dependencies. Do not fork package internals to fit an older app-level `ai` version.
- Local files are user-owned adapters. They should stay thin and call public package exports from `@vercel/geistdocs/*`.
- Do not copy package internals into the app to make a customization. Prefer configuring an adapter file or upgrading `@vercel/geistdocs`.
- Do not deep import from `@vercel/geistdocs/dist` or edit files in `node_modules/@vercel/geistdocs`.
- Do not edit generated directories such as `.source/`, `.next/`, `node_modules/`, or build output.

## Package docs for agents

- When package API behavior is unclear, read the installed package docs in `node_modules/@vercel/geistdocs/docs` before guessing.
- Start with `node_modules/@vercel/geistdocs/docs/agents.md` and `node_modules/@vercel/geistdocs/docs/sitemap.md` to identify the relevant focused page.
- Use `node_modules/@vercel/geistdocs/docs/pages/*.md` for task-specific guidance and `node_modules/@vercel/geistdocs/docs/llms.txt` only when you need broad package context.
- These package docs are read-only generated artifacts. Do not edit files under `node_modules/@vercel/geistdocs`; change local adapter files or update the package instead.

## Common edit targets

| Task | Edit |
| --- | --- |
| Configure site title, logo, nav, GitHub links, AI prompt, suggestions, translations, `basePath`, `siteId`, or agent-readiness metadata | `geistdocs.tsx` |
| Add or update documentation pages | `content/docs/**/*.mdx` |
| Add or update adapter listing pages | `content/adapters/**/*.mdx` and `adapters.json` |
| Control sidebar order, groups, and folder labels | `content/docs/meta.json`, `content/adapters/meta.json` |
| Give a page a shorter navigation label | Set `navTitle` in the page's frontmatter |
| Override MDX components | `components/geistdocs/mdx-components.tsx` |
| Wrap the site provider, analytics, or global client behavior | `components/geistdocs/provider.tsx` |
| Customize the docs layout shells | `components/geistdocs/docs-layout.tsx`, `components/geistdocs/adapters-docs-layout.tsx`, `components/geistdocs/home-layout.tsx` |
| Configure the Fumadocs source adapters | `lib/geistdocs/source.ts`, `lib/geistdocs/adapters-source.ts` |
| Configure Fumadocs collections and source-safe MDX processing | `source.config.ts` |
| Configure the docs page renderer | `app/[lang]/docs/[[...slug]]/page.tsx` |
| Configure AI-readable markdown output | `app/[lang]/agents.md/route.ts`, `app/[lang]/llms.txt/route.ts` (curated index), `app/[lang]/llms-full.txt/route.ts`, `app/[lang]/llms.mdx/[[...slug]]/route.ts`, `app/[lang]/adapters.mdx/[[...slug]]/route.ts`, `app/[lang]/sitemap.md/route.ts` |
| Configure chat or search APIs | `app/api/chat/route.ts`, `app/api/search/route.ts` |
| Add request handling before or after Geistdocs routing | `proxy.ts` |
| Edit the marketing home page | `app/[lang]/(home)/**` |
| Edit shared styles | `app/global.css`, `app/styles/geistdocs.css` |

## Content guidelines

- Put docs in `content/docs` and adapter pages in `content/adapters`.
- Add each new page to the directory's `meta.json` so it appears in the sidebar.
- Use MDX frontmatter with at least `title` and `description` for documentation pages. Set `navTitle` only when the navigation label should differ from the page heading.
- Keep slugs stable unless the task explicitly includes redirects or link updates.
- Use `CopyPrompt` when a page should give readers a prompt they can copy into a coding agent.

## Routing and proxy guidelines

- Keep App Router route files as thin adapters around package helpers such as `createDocsPage`, `createChatRoute`, `createProxy`, and the route factories under `@vercel/geistdocs/routes/*`.
- Keep `cacheComponents: true` and `partialPrefetching: true` in `next.config.ts`. Do not export `dynamic`, `revalidate`, or `fetchCache` from App Router pages or route handlers; package route factories may still return them, so destructure only `GET` and `generateStaticParams`. Cache custom data with `"use cache"` and `cacheLife` instead.
- Read `[lang]` from `next/root-params` (via `lib/geistdocs/root-params.ts`) in Server Components. Keep route context `params` in Route Handlers and Server Actions.
- Keep `generateStaticParams` for the root `lang` param in `app/[lang]/layout.tsx`; it must return every configured language.
- Use `prefetch={true}` for app-owned links to fully static documentation pages so navigation does not stop at the generic route shell.
- Keep `export const config` in `proxy.ts` as a static object. Next.js must parse proxy matchers at build time.
- Use proxy matcher exclusions that only match `/api` and `/api/...`, such as `api(?:/|$)`. Do not exclude broad prefixes like `api`, because that also excludes routes such as `/api-reference`.
- Preserve markdown negotiation unless the task explicitly changes AI-readable output. This site serves `/agents.md`, `/llms.txt`, `/llms-full.txt`, `/sitemap.md`, and per-page Markdown for `.md`, `.mdx`, `Accept: text/markdown`, and AI-agent requests across both the `/docs` and `/adapters` families.
- When adding custom proxy behavior, prefer `before`, `after`, and `markdownRoutes` options on `createProxy` instead of replacing the proxy. This site maps `/docs/*` and `/adapters/*` explicitly because the two families use different markdown route handlers.
- `llms.txt` is a curated index with section descriptions; do not replace it with the concatenated `createLlmsRoute` output. `llms-full.txt` serves the concatenated corpus.
- `/.well-known/mcp.json` intentionally returns 404; no MCP server is configured for this site.
- `/sitemap.xml` is served by an external rewrite in `next.config.ts`, not an app route.

## Ask AI guidelines

- Leave `GEISTDOCS_CHAT_PROXY_URL` unset to use the default AI Gateway path. The route adapter pins the model with `createChatRoute({ model })`.
- Geistdocs Ask AI targets AI SDK v6: `ai` v6 and `@ai-sdk/react` v3. Keep those dependencies on the package-pinned versions unless a `@vercel/geistdocs` release changes them.
- Keep `app/api/chat/route.ts` as a thin adapter around `createChatRoute`.

## Package updates

- Use `pnpm exec geistdocs update` to update the `@vercel/geistdocs` dependency. It does not overwrite local adapter files — diff them against the bundled template in `node_modules/@vercel/geistdocs/template` after every upgrade.
- Review dependency changes and run the verification commands before committing an update.

## Commands

Run from the repository root:

- Start development: `pnpm --filter docs dev`
- Build for production: `pnpm --filter docs build`
- Start the built app: `pnpm --filter docs start`
- Regenerate Fumadocs output after dependency installation: `pnpm --filter docs postinstall`

## Verification

- Run `pnpm --filter docs build` after changing routes, config, source setup, MDX components, or package versions, and confirm every known docs and adapter URL still has a complete static prerender.
- Run `pnpm --filter docs start` and open the changed pages when visual layout, navigation, or MDX rendering changes.
- Check both `/docs` and AI-readable routes such as `/agents.md`, `/llms.txt`, `/sitemap.md`, or a page-level `.md` URL when changing content routing or proxy behavior.
- Confirm no secrets were added to source files. Use `.env.local` for local values and keep it out of Git.
