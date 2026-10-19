/**
 * Shared schema.org building blocks for the JSON-LD on every chat-sdk.dev
 * page. Each page emits one `@graph` whose nodes reference each other by
 * `@id`, so search engines see a single connected entity graph:
 *
 * WebPage --isPartOf--> WebSite --publisher--> Organization (Vercel)
 *    |--breadcrumb--> BreadcrumbList
 *    |--mainEntity--> TechArticle / SoftwareSourceCode / ItemList
 */

export const SITE_URL = "https://chat-sdk.dev";
export const SITE_NAME = "Chat SDK";
export const SITE_LANGUAGE = "en";
const SITE_DESCRIPTION =
  "A unified TypeScript SDK for building chat bots and agents across Slack, Microsoft Teams, Google Chat, Discord, Telegram, WhatsApp, and more.";

export const ORGANIZATION_ID = "https://vercel.com/#organization";
export const WEBSITE_ID = `${SITE_URL}/#website`;
/** The Chat SDK software entity described on the home page. */
export const SOFTWARE_ID = `${SITE_URL}/#software`;

export const REPOSITORY_URL = "https://github.com/vercel/chat";
export const MIT_LICENSE_URL = "https://opensource.org/licenses/MIT";

export type JsonLdNode = Record<string, unknown>;

export interface BreadcrumbEntry {
  name: string;
  url: string;
}

export const absoluteUrl = (path: string): string =>
  path.startsWith("http") ? path : new URL(path, SITE_URL).toString();

export const npmPackageUrl = (packageName: string): string =>
  `https://www.npmjs.com/package/${packageName}`;

const organizationNode: JsonLdNode = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: "Vercel",
  url: "https://vercel.com",
  sameAs: ["https://github.com/vercel", "https://x.com/vercel"],
};

const websiteNode: JsonLdNode = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  inLanguage: SITE_LANGUAGE,
  publisher: { "@id": ORGANIZATION_ID },
};

/**
 * Inline reference to the Chat SDK software entity for pages other than the
 * home page, which describes it in full.
 */
export const softwareReference: JsonLdNode = {
  "@type": "SoftwareSourceCode",
  "@id": SOFTWARE_ID,
  name: SITE_NAME,
  url: SITE_URL,
};

const breadcrumbId = (pageUrl: string) => `${pageUrl}#breadcrumb`;

/** Build a `BreadcrumbList`; the site root is always the first item. */
export const breadcrumbNode = (
  pageUrl: string,
  entries: readonly BreadcrumbEntry[]
): JsonLdNode => ({
  "@type": "BreadcrumbList",
  "@id": breadcrumbId(pageUrl),
  itemListElement: [{ name: SITE_NAME, url: SITE_URL }, ...entries].map(
    (entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: absoluteUrl(entry.url),
    })
  ),
});

interface WebPageNodeInput {
  description?: string;
  hasBreadcrumb?: boolean;
  image?: string;
  mainEntityId?: string;
  name: string;
  type?: "WebPage" | "CollectionPage";
  url: string;
}

export const webPageNode = ({
  description,
  hasBreadcrumb = true,
  image,
  mainEntityId,
  name,
  type = "WebPage",
  url,
}: WebPageNodeInput): JsonLdNode => ({
  "@type": type,
  "@id": url,
  url,
  name,
  ...(description ? { description } : {}),
  inLanguage: SITE_LANGUAGE,
  isPartOf: { "@id": WEBSITE_ID },
  ...(hasBreadcrumb ? { breadcrumb: { "@id": breadcrumbId(url) } } : {}),
  ...(image
    ? { primaryImageOfPage: { "@type": "ImageObject", url: image } }
    : {}),
  ...(mainEntityId ? { mainEntity: { "@id": mainEntityId } } : {}),
});

/**
 * Wrap page nodes in a single `@graph`, adding the shared `Organization` and
 * `WebSite` nodes so every `@id` reference resolves within the page.
 */
export const jsonLdGraph = (nodes: readonly JsonLdNode[]) => ({
  "@context": "https://schema.org",
  "@graph": [organizationNode, websiteNode, ...nodes],
});
