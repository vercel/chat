import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdapterHero } from "@/components/geistdocs/adapter-hero";
import { DocsBody, DocsPage } from "@/components/geistdocs/docs-page";
import { FeatureSupport } from "@/components/geistdocs/feature-support";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { Upsell } from "@/components/geistdocs/upsell";
import type { AdapterFeatureValue } from "@/lib/adapter-features";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";

interface AdapterFrontmatter {
  beta?: boolean;
  description: string;
  features?: Record<string, AdapterFeatureValue>;
  logo?: string;
  packageName: string;
  slug: string;
  tagline: string;
  title: string;
  type: "platform" | "state";
}

interface PageParams {
  lang: string;
  slug: string;
}

const renderBoundFeatureSupport = (
  features: Record<string, AdapterFeatureValue> | undefined,
  type: "platform" | "state"
) => {
  const Bound = () => <FeatureSupport features={features} type={type} />;
  Bound.displayName = "BoundFeatureSupport";
  return Bound;
};

const Page = async ({ params }: { params: Promise<PageParams> }) => {
  const { slug, lang } = await params;
  const page = adaptersSource.getPage(["official", slug], lang);

  if (!page) {
    notFound();
  }

  const data = page.data as unknown as AdapterFrontmatter;
  const MDX = page.data.body;
  const BoundFeatureSupport = renderBoundFeatureSupport(
    data.features,
    data.type
  );

  return (
    <DocsPage
      tableOfContent={{
        style: "clerk",
        footer: (
          <div className="my-3">
            <Upsell />
          </div>
        ),
      }}
      tableOfContentPopover={{ enabled: false }}
      toc={page.data.toc}
    >
      <DocsBody>
        <AdapterHero
          beta={data.beta}
          logo={data.logo}
          name={data.title}
          packageName={data.packageName}
          tagline={data.tagline}
        />
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(adaptersSource, page),
            FeatureSupport: BoundFeatureSupport,
          })}
        />
      </DocsBody>
    </DocsPage>
  );
};

export const generateStaticParams = () =>
  adaptersSource
    .generateParams()
    .filter((entry) => entry.slug?.[0] === "official")
    .map((entry) => ({ lang: entry.lang, slug: entry.slug?.[1] }));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> => {
  const { slug, lang } = await params;
  const page = adaptersSource.getPage(["official", slug], lang);

  if (!page) {
    return {};
  }

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: `/${lang}/adapters/official/${slug}/og`,
    },
    twitter: {
      card: "summary_large_image",
    },
  };
};

export default Page;
