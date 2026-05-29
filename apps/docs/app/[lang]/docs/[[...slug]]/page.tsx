import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AskAI } from "@/components/geistdocs/ask-ai";
import { CopyPage } from "@/components/geistdocs/copy-page";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "@/components/geistdocs/docs-page";
import { EditSource } from "@/components/geistdocs/edit-source";
import { Feedback } from "@/components/geistdocs/feedback";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { MobileDocsBar } from "@/components/geistdocs/mobile-docs-bar";
import { OpenInChat } from "@/components/geistdocs/open-in-chat";
import { ScrollTop } from "@/components/geistdocs/scroll-top";
import { Separator } from "@/components/ui/separator";
import { getLLMText, getPageImage, source } from "@/lib/geistdocs/source";

const Page = async ({ params }: PageProps<"/[lang]/docs/[[...slug]]">) => {
  const { slug, lang } = await params;
  const page = source.getPage(slug, lang);

  if (!page) {
    notFound();
  }

  const markdown = await getLLMText(page);
  const MDX = page.data.body;
  const slugPath = slug?.join("/");
  const markdownPath = slugPath ? `/docs/${slugPath}.md` : "/docs.md";

  return (
    <DocsPage
      full={page.data.full}
      tableOfContent={{
        style: "clerk",
        footer: (
          <div className="my-3 space-y-3">
            <Separator />
            <EditSource path={page.path} />
            <ScrollTop />
            <Feedback />
            <CopyPage text={markdown} />
            <AskAI href={page.url} />
            <OpenInChat href={page.url} />
          </div>
        ),
      }}
      tableOfContentPopover={{ enabled: false }}
      toc={page.data.toc}
    >
      <MobileDocsBar toc={page.data.toc} />
      <a aria-hidden="true" className="sr-only" href={markdownPath} tabIndex={-1}>
        AI/LLM: This documentation page is available in plain markdown format at
        {markdownPath}
      </a>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),

            // Add your custom components here
          })}
        />
      </DocsBody>
    </DocsPage>
  );
};

export const generateStaticParams = () => source.generateParams();

export const generateMetadata = async ({
  params,
}: PageProps<"/[lang]/docs/[[...slug]]">) => {
  const { slug, lang } = await params;
  const page = source.getPage(slug, lang);

  if (!page) {
    notFound();
  }

  const metadata: Metadata = {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: page.data.title,
      images: getPageImage(page).url,
    },
    twitter: {
      card: "summary_large_image",
    },
    alternates: {
      types: {
        "text/markdown": slug?.length ? `/docs/${slug.join("/")}.md` : "/docs.md",
      },
    },
  };

  return metadata;
};

export default Page;
