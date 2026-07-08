import { createProxy } from "@vercel/geistdocs/proxy";
import { config as geistdocsConfig } from "@/lib/geistdocs/config";
import { trackMdRequest } from "@/lib/geistdocs/md-tracking";

const proxy = createProxy({
  config: geistdocsConfig,
  // The docs and adapters sections use different markdown route handlers, so
  // map each family explicitly instead of relying on inference from
  // `config.content`.
  markdownRoutes: [
    { from: "/docs/*path", to: "/[lang]/llms.mdx/*path" },
    { from: "/adapters/*path", to: "/[lang]/adapters.mdx/*path" },
  ],
  trackMarkdownRequest: trackMdRequest,
  // `createProxy` tracks /llms.txt itself; keep tracking the legacy
  // /llms-full.txt corpus route too.
  before: ({ context, request }) => {
    if (request.nextUrl.pathname === "/llms-full.txt") {
      context.waitUntil(
        trackMdRequest({
          path: "/llms-full.txt",
          userAgent: request.headers.get("user-agent"),
          referer: request.headers.get("referer"),
          acceptHeader: request.headers.get("accept"),
        })
      );
    }

    return null;
  },
});

export const config = {
  // Matcher ignoring `/_next/`, `/api/`, static assets, favicon, sitemap, robots, etc.
  matcher: [
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|opengraph-image\\.png|AGENTS.md|\\.well-known).*)",
  ],
};

export default proxy;
