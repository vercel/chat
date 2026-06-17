import type { InferPageType } from "fumadocs-core/source";
import type { source } from "./source";

const BASE_URL = "https://chat-sdk.dev";

const VERCEL_ORG = {
  "@type": "Organization",
  name: "Vercel",
  url: "https://vercel.com",
};

/** Core docs pages that emit structured data for search and answer engines. */
const JSON_LD_DOC_SLUGS = new Set(["getting-started", "streaming", "cards"]);

type DocsPage = InferPageType<typeof source>;

const getDocsPageUrl = (pageUrl: string) =>
  pageUrl.startsWith("http") ? pageUrl : `${BASE_URL}${pageUrl}`;

const getDocsBreadcrumb = (title: string, pageUrl: string) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Chat SDK", item: BASE_URL },
    {
      "@type": "ListItem",
      position: 2,
      name: "Documentation",
      item: `${BASE_URL}/docs`,
    },
    { "@type": "ListItem", position: 3, name: title, item: pageUrl },
  ],
});

const getStepNameFromTocEntry = (entry: {
  title: DocsPage["data"]["toc"][number]["title"];
  url: string;
}): string => {
  if (typeof entry.title === "string" && entry.title.length > 0) {
    return entry.title;
  }

  const hash = entry.url.startsWith("#") ? entry.url.slice(1) : entry.url;
  return hash
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

const getHowToJsonLd = (
  title: string,
  description: string | undefined,
  pageUrl: string,
  toc: DocsPage["data"]["toc"]
) => {
  const steps = (toc ?? [])
    .filter((entry) => entry.depth === 2)
    .map((entry, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: getStepNameFromTocEntry(entry),
      url: `${pageUrl}${entry.url}`,
    }));

  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: title,
    description,
    url: pageUrl,
    publisher: VERCEL_ORG,
    ...(steps.length > 0 ? { step: steps } : {}),
  };
};

const getTechArticleJsonLd = (
  title: string,
  description: string | undefined,
  pageUrl: string
) => ({
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: title,
  description,
  url: pageUrl,
  author: VERCEL_ORG,
  publisher: VERCEL_ORG,
});

/**
 * Build JSON-LD for selected core documentation pages.
 * Guides (`type: guide`) emit `HowTo` with h2 sections as steps; hub pages use
 * `TechArticle`. Always includes a `BreadcrumbList`.
 */
export const getDocsJsonLd = (page: DocsPage) => {
  const slug = page.slugs.join("/");
  if (!JSON_LD_DOC_SLUGS.has(slug)) {
    return null;
  }

  const pageUrl = getDocsPageUrl(page.url);
  const { title, description, type, toc } = page.data;
  const breadcrumb = getDocsBreadcrumb(title, pageUrl);

  if (type === "guide") {
    return [getHowToJsonLd(title, description, pageUrl, toc), breadcrumb];
  }

  return [getTechArticleJsonLd(title, description, pageUrl), breadcrumb];
};
