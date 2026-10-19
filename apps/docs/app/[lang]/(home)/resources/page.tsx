import { get } from "@vercel/edge-config";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { JsonLd } from "@/components/geistdocs/json-ld";
import {
  absoluteUrl,
  breadcrumbNode,
  jsonLdGraph,
  webPageNode,
} from "@/lib/geistdocs/jsonld";
import localData from "@/resources-edge-config.json";
import { type Resource, ResourceCard } from "./components/resource-card";

const RESOURCES_PATH = "/resources";
const RESOURCES_DESCRIPTION =
  "Guides, templates, and examples to help you build with Chat SDK.";

export const metadata: Metadata = {
  title: "Resources",
  description: RESOURCES_DESCRIPTION,
  keywords: [
    "chat sdk",
    "guides",
    "templates",
    "slack bot",
    "ai agent",
    "vercel",
  ],
  openGraph: {
    title: "Resources",
    images: "/opengraph-image.png",
  },
  twitter: {
    card: "summary_large_image",
  },
};

const getResources = async (): Promise<Resource[]> => {
  "use cache";
  cacheLife("days");

  if (process.env.NODE_ENV === "development") {
    return localData.resources as Resource[];
  }
  try {
    return (await get<Resource[]>("resources")) ?? [];
  } catch {
    return [];
  }
};

const ResourcesPage = async () => {
  const resources = await getResources();
  const pageUrl = absoluteUrl(RESOURCES_PATH);
  const itemListId = `${pageUrl}#resources`;
  const jsonLd = jsonLdGraph([
    webPageNode({
      description: RESOURCES_DESCRIPTION,
      image: absoluteUrl("/opengraph-image.png"),
      mainEntityId: itemListId,
      name: "Resources",
      type: "CollectionPage",
      url: pageUrl,
    }),
    {
      "@type": "ItemList",
      "@id": itemListId,
      name: "Chat SDK guides, templates, and examples",
      numberOfItems: resources.length,
      itemListElement: resources.map((resource, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: resource.title,
        description: resource.description,
        url: absoluteUrl(resource.href),
      })),
    },
    breadcrumbNode(pageUrl, [{ name: "Resources", url: RESOURCES_PATH }]),
  ]);

  return (
    <div className="container mx-auto max-w-5xl">
      <JsonLd data={jsonLd} />
      <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
        <h1 className="text-balance text-heading-40 sm:text-heading-48">
          Resources
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
          Guides, templates, and examples to help you build with Chat SDK.
        </p>
      </section>

      <section className="px-4 pb-16">
        {resources && resources.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((resource) => (
              <ResourceCard key={resource.href} {...resource} />
            ))}
          </div>
        ) : (
          <p className="py-12 text-center text-muted-foreground">
            No resources available yet. Check back soon.
          </p>
        )}
      </section>
    </div>
  );
};

export default ResourcesPage;
