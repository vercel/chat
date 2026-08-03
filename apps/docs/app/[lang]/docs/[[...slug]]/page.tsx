import { MobileDocsBar } from "@vercel/geistdocs/mobile-docs-bar";
import { createDocsPage } from "@vercel/geistdocs/pages/docs";
import type { Metadata } from "next";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { config } from "@/lib/geistdocs/config";
import { getDocsJsonLd } from "@/lib/geistdocs/docs-jsonld";
import { geistdocsSource } from "@/lib/geistdocs/source";

const docsPage = createDocsPage({
  config,
  mdx: ({ link }) => getMDXComponents({ a: link }),
  metadata: ({ metadata }): Metadata => ({
    ...metadata,
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
    const jsonLd = getDocsJsonLd(page);

    return (
      <>
        <MobileDocsBar toc={data.toc} />
        {jsonLd ? (
          <script
            // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD, not user input
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            type="application/ld+json"
          />
        ) : null}
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
