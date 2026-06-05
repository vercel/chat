import { type Adapter, getAuthor } from "./adapter-readme";

const BASE_URL = "https://chat-sdk.dev";

export const ADAPTERS_LISTING_DESCRIPTION =
  "Browse official Chat SDK platform and state adapters, plus community and vendor-built integrations. Connect your bot to Slack, Teams, Discord, and more.";

/** Matches the official-only `ItemList` in adapters listing JSON-LD. */
export const ADAPTERS_LISTING_JSON_LD_DESCRIPTION =
  "Official Chat SDK platform and state adapters for Slack, Teams, Google Chat, Discord, WhatsApp, and more.";

type AdapterGroup = "official" | "community" | "vendor-official";

const VERCEL_AUTHOR = {
  "@type": "Organization",
  name: "Vercel",
  url: "https://vercel.com",
};

interface AdapterJsonLdInput {
  adapter?: Adapter;
  group: AdapterGroup;
  packageName: string;
  slug: string;
  tagline: string;
  title: string;
}

/**
 * Build JSON-LD for an adapter detail page: a `SoftwareSourceCode` node
 * describing the adapter package and a `BreadcrumbList` for the page's
 * position in the site hierarchy.
 */
export const getAdapterJsonLd = ({
  adapter,
  group,
  packageName,
  slug,
  tagline,
  title,
}: AdapterJsonLdInput) => {
  const pageUrl = `${BASE_URL}/adapters/${group}/${slug}`;
  const authorName = adapter ? getAuthor(adapter) : undefined;

  // Only official adapters are authored by Vercel. Community/vendor-official
  // adapters use their declared author, and omit the field entirely when none
  // is declared — never fall back to Vercel.
  let author: Record<string, string> | undefined;
  if (group === "official") {
    author = VERCEL_AUTHOR;
  } else if (authorName) {
    author = { "@type": "Organization", name: authorName };
  }

  const softwareSourceCode = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: packageName,
    description: tagline,
    url: pageUrl,
    programmingLanguage: "TypeScript",
    runtimePlatform: "Node.js",
    ...(author ? { author } : {}),
    ...(adapter?.readme ? { codeRepository: adapter.readme } : {}),
    ...(group === "official"
      ? { license: "https://opensource.org/licenses/MIT" }
      : {}),
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Chat SDK", item: BASE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Adapters",
        item: `${BASE_URL}/adapters`,
      },
      { "@type": "ListItem", position: 3, name: title, item: pageUrl },
    ],
  };

  return [softwareSourceCode, breadcrumb];
};

interface ListingAdapter {
  community?: boolean;
  description: string;
  name: string;
  slug: string;
}

/**
 * Build JSON-LD for the adapters listing page: a `CollectionPage` with an
 * `ItemList` of official (Vercel-maintained) adapters and state packages.
 */
export const getAdaptersListingJsonLd = (adapters: ListingAdapter[]) => {
  const officialAdapters = adapters.filter((adapter) => !adapter.community);
  const adaptersUrl = `${BASE_URL}/adapters`;

  const collectionPage = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": adaptersUrl,
    name: "Adapters",
    description: ADAPTERS_LISTING_JSON_LD_DESCRIPTION,
    url: adaptersUrl,
    mainEntity: {
      "@type": "ItemList",
      name: "Official Chat SDK platform and state adapters",
      numberOfItems: officialAdapters.length,
      itemListElement: officialAdapters.map((adapter, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: adapter.name,
        description: adapter.description,
        url: `${BASE_URL}/adapters/official/${adapter.slug}`,
      })),
    },
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Chat SDK", item: BASE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Adapters",
        item: adaptersUrl,
      },
    ],
  };

  return [collectionPage, breadcrumb];
};
