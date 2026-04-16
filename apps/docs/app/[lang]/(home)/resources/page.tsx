import { get } from "@vercel/edge-config";
import type { Metadata } from "next";
import localData from "@/resources-edge-config.json";
import { type Resource, ResourceCard } from "./components/resource-card";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Guides, templates, and examples to help you build with Chat SDK.",
};

const getResources = async (): Promise<Resource[]> => {
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

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Resources",
    description:
      "Guides, templates, and examples to help you build with Chat SDK.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: resources.map((resource, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: resource.title,
        description: resource.description,
        url: resource.href,
      })),
    },
  };

  return (
    <div className="container mx-auto max-w-5xl">
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Next.js recommended pattern for JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
        <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
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
