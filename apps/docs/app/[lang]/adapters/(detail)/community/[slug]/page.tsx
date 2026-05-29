import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps, FC } from "react";
import { AdapterHero } from "@/components/geistdocs/adapter-hero";
import { DocsBody, DocsPage } from "@/components/geistdocs/docs-page";
import { FeatureSupport } from "@/components/geistdocs/feature-support";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { Upsell } from "@/components/geistdocs/upsell";
import type { AdapterFeatureValue } from "@/lib/adapter-features";
import {
  type Adapter,
  getAdapter,
  getIssuesUrl,
  getReadme,
} from "@/lib/geistdocs/adapter-readme";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { ReadmeContent } from "../../../components/readme-content";

const EXTERNAL_HREF_PATTERN = /^https?:\/\//i;

type MdxLinkProps = ComponentProps<"a">;

const wrapWithNofollow = (BaseLink: FC<MdxLinkProps>): FC<MdxLinkProps> => {
  const NofollowExternalLink: FC<MdxLinkProps> = (props) => {
    if (props.href && EXTERNAL_HREF_PATTERN.test(props.href)) {
      const { children, ...rest } = props;
      return (
        <a {...rest} rel="nofollow ugc noopener noreferrer" target="_blank">
          {children}
        </a>
      );
    }
    return <BaseLink {...props} />;
  };
  return NofollowExternalLink;
};

const CommunityNotice = ({ adapter }: { adapter: Adapter }) => {
  const issuesUrl = getIssuesUrl(adapter.readme);

  return (
    <div className="mb-8 rounded-md border bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
      <strong className="text-foreground">Community adapter.</strong> Not
      maintained by Vercel or Chat SDK contributors. For feature requests, bug
      reports, and support,{" "}
      {issuesUrl ? (
        <a
          className="text-primary underline hover:no-underline"
          href={issuesUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          file an issue on the adapter&apos;s repo
        </a>
      ) : (
        <span>file an issue on the adapter&apos;s repo</span>
      )}
      .
    </div>
  );
};

interface AdapterFrontmatter {
  community?: boolean;
  description: string;
  features?: Record<string, AdapterFeatureValue>;
  logo?: string;
  mdxBody?: boolean;
  packageName: string;
  slug: string;
  tagline: string;
  title: string;
  type: "platform" | "state";
}

const renderBoundFeatureSupport = (
  features: Record<string, AdapterFeatureValue> | undefined,
  type: "platform" | "state"
) => {
  const Bound = () => <FeatureSupport features={features} type={type} />;
  Bound.displayName = "BoundFeatureSupport";
  return Bound;
};

interface PageParams {
  lang: string;
  slug: string;
}

const Page = async ({ params }: { params: Promise<PageParams> }) => {
  const { slug, lang } = await params;
  const page = adaptersSource.getPage(["community", slug], lang);

  if (!page) {
    notFound();
  }

  const data = page.data as unknown as AdapterFrontmatter;
  const adapter = getAdapter(slug);
  const markdownPath = `/adapters/community/${slug}.md`;
  const useMdxBody = data.mdxBody === true;
  let readme: string | undefined;
  if (!useMdxBody && adapter) {
    readme = await getReadme(adapter, { warnOnUnpinnedRef: true });
  }
  const MDX = page.data.body;
  const BoundFeatureSupport = renderBoundFeatureSupport(
    data.features,
    data.type
  );

  const renderBody = () => {
    if (useMdxBody) {
      return (
        <MDX
          components={getMDXComponents({
            a: wrapWithNofollow(createRelativeLink(adaptersSource, page)),
            FeatureSupport: BoundFeatureSupport,
          })}
        />
      );
    }
    if (readme) {
      return <ReadmeContent>{readme}</ReadmeContent>;
    }
    return (
      <p className="text-muted-foreground">
        README not available. Visit the{" "}
        {adapter?.readme ? (
          <a
            className="text-primary underline"
            href={adapter.readme}
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub repository
          </a>
        ) : (
          "adapter's repository"
        )}{" "}
        for documentation.
      </p>
    );
  };

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
        {/* biome-ignore lint/a11y/useAnchorContent: intentionally aria-hidden hint surfacing the markdown URL for AI/LLM crawlers, not for screen readers */}
        <a
          aria-hidden="true"
          className="sr-only"
          href={markdownPath}
          tabIndex={-1}
        >
          AI/LLM: This adapter page is available in plain markdown format at
          {markdownPath}
        </a>
        <AdapterHero
          community
          logo={data.logo}
          name={data.title}
          packageName={data.packageName}
          tagline={data.tagline}
        />
        {adapter ? <CommunityNotice adapter={adapter} /> : null}
        {renderBody()}
      </DocsBody>
    </DocsPage>
  );
};

export const generateStaticParams = () =>
  adaptersSource
    .generateParams()
    .filter((entry) => entry.slug?.[0] === "community")
    .map((entry) => ({ lang: entry.lang, slug: entry.slug?.[1] }));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> => {
  const { slug, lang } = await params;
  const page = adaptersSource.getPage(["community", slug], lang);

  if (!page) {
    return {};
  }

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: page.data.title,
      images: `/${lang}/adapters/community/${slug}/og`,
    },
    twitter: {
      card: "summary_large_image",
    },
    alternates: {
      types: {
        "text/markdown": `/adapters/community/${slug}.md`,
      },
    },
  };
};

export default Page;
