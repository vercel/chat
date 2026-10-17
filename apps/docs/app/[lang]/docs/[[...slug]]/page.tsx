import { MobileDocsBar } from "@vercel/geistdocs/mobile-docs-bar";
import { createDocsPage } from "@vercel/geistdocs/pages/docs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ReadMore } from "@/components/custom/read-more";
import { JsonLd } from "@/components/geistdocs/json-ld";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { config } from "@/lib/geistdocs/config";
import { getDocsJsonLd } from "@/lib/geistdocs/docs-jsonld";
import { geistdocsSource, getPageImage, source } from "@/lib/geistdocs/source";

const docsPage = createDocsPage({
  config,
  mdx: ({ link, page, source }) =>
    getMDXComponents({
      a: link,
      wrapper: ({ children }: { children?: ReactNode }) => (
        <>
          {children}
          <ReadMore page={page} source={source} />
        </>
      ),
    }),
  metadata: ({ metadata, page }): Metadata => ({
    ...metadata,
    alternates: {
      ...metadata.alternates,
      canonical: page.url,
    },
    openGraph: {
      ...metadata.openGraph,
      title: metadata.title ?? undefined,
    },
    twitter: {
      card: "summary_large_image",
    },
  }),
  openGraph: {
    images: true,
  },
  source: geistdocsSource,
  tableOfContentPopover: {
    enabled: false,
  },
  renderTop: ({ data, page, pageUrl }) => {
    const markdownPath = pageUrl === "/docs" ? "/docs.md" : `${pageUrl}.md`;
    const jsonLd = getDocsJsonLd({
      getPage: (slugs) => source.getPage(slugs, page.locale),
      image: getPageImage(page).url,
      page,
      tree: source.getPageTree(page.locale),
    });

    return (
      <>
        <MobileDocsBar toc={data.toc} />
        <JsonLd data={jsonLd} />
        {/* biome-ignore lint/a11y/useAnchorContent: intentionally aria-hidden hint surfacing the markdown URL for AI/LLM crawlers, not for screen readers */}
        <a
          aria-hidden="true"
          className="sr-only"
          href={markdownPath}
          tabIndex={-1}
        >
          AI/LLM: This documentation page is available in plain markdown format
          at {markdownPath}
        </a>
      </>
    );
  },
});

export default docsPage.Page;
export const generateStaticParams = docsPage.generateStaticParams;
export const generateMetadata = docsPage.generateMetadata;
