import type { AdapterGroup } from "@chat-adapter/catalog";
import { type Adapter, getAuthor } from "./adapter-readme";
import {
  absoluteUrl,
  breadcrumbNode,
  jsonLdGraph,
  MIT_LICENSE_URL,
  npmPackageUrl,
  ORGANIZATION_ID,
  softwareReference,
  webPageNode,
} from "./jsonld";

export const ADAPTERS_LISTING_DESCRIPTION =
  "Browse official Chat SDK platform and state adapters, plus community and vendor-built integrations. Connect your bot to Slack, Teams, Discord, and more.";

/** Matches the official-only `ItemList` in adapters listing JSON-LD. */
export const ADAPTERS_LISTING_JSON_LD_DESCRIPTION =
  "Official Chat SDK platform and state adapters for Slack, Teams, Google Chat, Discord, WhatsApp, and more.";

const ADAPTERS_CRUMB = { name: "Adapters", url: "/adapters" };

interface AdapterJsonLdInput {
  adapter?: Adapter;
  group: AdapterGroup;
  packageName: string;
  slug: string;
  tagline: string;
  title: string;
}

/**
 * Build JSON-LD for an adapter detail page: a `WebPage` whose main entity is
 * a `SoftwareSourceCode` node describing the adapter package, plus a
 * `BreadcrumbList` for the page's position in the site hierarchy.
 */
export const getAdapterJsonLd = ({
  adapter,
  group,
  packageName,
  slug,
  tagline,
  title,
}: AdapterJsonLdInput) => {
  const pagePath = `/adapters/${group}/${slug}`;
  const pageUrl = absoluteUrl(pagePath);
  const softwareId = `${pageUrl}#software`;
  const imageUrl = absoluteUrl(`${pagePath}/og`);
  const authorName = adapter ? getAuthor(adapter) : undefined;
  const isOfficial = group === "official";

  // Only official adapters are authored by Vercel. Community/vendor-official
  // adapters use their declared author, and omit the field entirely when none
  // is declared — never fall back to Vercel.
  let author: Record<string, string> | undefined;
  if (isOfficial) {
    author = { "@id": ORGANIZATION_ID };
  } else if (authorName) {
    author = { "@type": "Organization", name: authorName };
  }

  const softwareSourceCode = {
    "@type": "SoftwareSourceCode",
    "@id": softwareId,
    name: packageName,
    alternateName: `${title} adapter for Chat SDK`,
    description: tagline,
    url: pageUrl,
    image: imageUrl,
    programmingLanguage: "TypeScript",
    runtimePlatform: "Node.js",
    sameAs: [npmPackageUrl(packageName)],
    ...(author ? { author } : {}),
    ...(adapter?.readme ? { codeRepository: adapter.readme } : {}),
    // Official adapters live in the Chat SDK monorepo under the MIT license.
    ...(isOfficial
      ? {
          isPartOf: softwareReference,
          license: MIT_LICENSE_URL,
          publisher: { "@id": ORGANIZATION_ID },
        }
      : {}),
  };

  return jsonLdGraph([
    webPageNode({
      description: tagline,
      image: imageUrl,
      mainEntityId: softwareId,
      name: title,
      url: pageUrl,
    }),
    softwareSourceCode,
    breadcrumbNode(pageUrl, [ADAPTERS_CRUMB, { name: title, url: pagePath }]),
  ]);
};

interface ListingAdapter {
  description: string;
  group: AdapterGroup;
  name: string;
  slug: string;
}

/**
 * Build JSON-LD for the adapters listing page: a `CollectionPage` with an
 * `ItemList` of official (Vercel-maintained) adapters and state packages.
 */
export const getAdaptersListingJsonLd = (
  adapters: readonly ListingAdapter[]
) => {
  const officialAdapters = adapters.filter(
    (adapter) => adapter.group === "official"
  );
  const adaptersUrl = absoluteUrl(ADAPTERS_CRUMB.url);
  const itemListId = `${adaptersUrl}#adapters`;

  return jsonLdGraph([
    webPageNode({
      description: ADAPTERS_LISTING_JSON_LD_DESCRIPTION,
      image: absoluteUrl("/opengraph-image.png"),
      mainEntityId: itemListId,
      name: "Adapters",
      type: "CollectionPage",
      url: adaptersUrl,
    }),
    {
      "@type": "ItemList",
      "@id": itemListId,
      name: "Official Chat SDK platform and state adapters",
      numberOfItems: officialAdapters.length,
      itemListElement: officialAdapters.map((adapter, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: adapter.name,
        description: adapter.description,
        url: absoluteUrl(`/adapters/official/${adapter.slug}`),
      })),
    },
    breadcrumbNode(adaptersUrl, [ADAPTERS_CRUMB]),
  ]);
};
