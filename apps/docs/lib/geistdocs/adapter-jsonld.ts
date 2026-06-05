import { type Adapter, getAuthor } from "./adapter-readme";

const BASE_URL = "https://chat-sdk.dev";

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
