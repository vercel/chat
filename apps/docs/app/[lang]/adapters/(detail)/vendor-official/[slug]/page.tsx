import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import adaptersJson from "@/adapters.json";
import { AdapterHero } from "@/components/geistdocs/adapter-hero";
import { DocsBody, DocsPage } from "@/components/geistdocs/docs-page";
import { FeatureSupport } from "@/components/geistdocs/feature-support";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { Upsell } from "@/components/geistdocs/upsell";
import type { AdapterFeatureValue } from "@/lib/adapter-features";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { ReadmeContent } from "../../../components/readme-content";

const LOCAL_PACKAGE_PATTERN = /github\.com\/vercel\/chat\/tree\/[^/]+\/(.+)/;
const GITHUB_SUBPATH_PATTERN =
  /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/;
const GITHUB_REPO_REF_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?$/;
const GITHUB_REPO_PATTERN = /github\.com\/([^/]+)\/([^/]+)/;
const GITHUB_REPO_ROOT_PATTERN = /^(https:\/\/github\.com\/[^/]+\/[^/]+)/;

const MAX_README_BYTES = 500_000;

type Adapter = (typeof adaptersJson)[number];

const getAdapter = (slug: string): Adapter | undefined =>
  adaptersJson.find((a) => a.slug === slug);

const getAuthor = (adapter: Adapter): string | undefined =>
  "author" in adapter ? adapter.author : undefined;

const getIssuesUrl = (readmeUrl: string | undefined): string | undefined => {
  if (!readmeUrl) {
    return;
  }
  const match = readmeUrl.match(GITHUB_REPO_ROOT_PATTERN);
  return match ? `${match[1]}/issues` : undefined;
};

const truncate = (content: string): string =>
  content.length <= MAX_README_BYTES
    ? content
    : `${content.slice(0, MAX_README_BYTES)}\n\n> _README truncated — view the full version on GitHub._`;

const fetchGitHubReadme = async (url: string): Promise<string | undefined> => {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github.raw+json" },
    next: { revalidate: 3600 },
  });
  if (response.ok) {
    return response.text();
  }
};

const getReadme = async (adapter: Adapter): Promise<string | undefined> => {
  if (!adapter.readme) {
    return;
  }
  const repoUrl = adapter.readme;

  const localMatch = repoUrl.match(LOCAL_PACKAGE_PATTERN);
  if (localMatch) {
    const [, pkgPath] = localMatch;
    const filePath = join(process.cwd(), "..", "..", pkgPath, "README.md");
    try {
      return truncate(await readFile(filePath, "utf-8"));
    } catch {
      return;
    }
  }

  const subpathMatch = repoUrl.match(GITHUB_SUBPATH_PATTERN);
  if (subpathMatch) {
    const [, owner, repo, ref, path] = subpathMatch;
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme/${path}?ref=${ref}`
    );
    return content ? truncate(content) : undefined;
  }

  const repoRefMatch = repoUrl.match(GITHUB_REPO_REF_PATTERN);
  if (repoRefMatch) {
    const [, owner, repo, ref] = repoRefMatch;
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme?ref=${ref}`
    );
    return content ? truncate(content) : undefined;
  }

  const repoMatch = repoUrl.match(GITHUB_REPO_PATTERN);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme`
    );
    return content ? truncate(content) : undefined;
  }
};

const VendorOfficialNotice = ({ adapter }: { adapter: Adapter }) => {
  const issuesUrl = getIssuesUrl(adapter.readme);
  const author = getAuthor(adapter);

  return (
    <div className="mb-8 rounded-md border bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
      <strong className="text-foreground">Vendor-official adapter</strong>
      {author ? (
        <>
          {" "}
          maintained by {author}, not Vercel or Chat SDK contributors. For
          feature requests, bug reports, and support,{" "}
        </>
      ) : (
        <>
          {" "}
          maintained by the platform vendor, not Vercel or Chat SDK
          contributors. For feature requests, bug reports, and support,{" "}
        </>
      )}
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
  const page = adaptersSource.getPage(["vendor-official", slug], lang);

  if (!page) {
    notFound();
  }

  const data = page.data as unknown as AdapterFrontmatter;
  const adapter = getAdapter(slug);
  const useMdxBody = data.mdxBody === true;
  let readme: string | undefined;
  if (!useMdxBody && adapter) {
    readme = await getReadme(adapter);
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
            a: createRelativeLink(adaptersSource, page),
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
        <AdapterHero
          logo={data.logo}
          name={data.title}
          packageName={data.packageName}
          tagline={data.tagline}
          vendorOfficial
        />
        {adapter ? <VendorOfficialNotice adapter={adapter} /> : null}
        {renderBody()}
      </DocsBody>
    </DocsPage>
  );
};

export const generateStaticParams = () =>
  adaptersSource
    .generateParams()
    .filter((entry) => entry.slug?.[0] === "vendor-official")
    .map((entry) => ({ lang: entry.lang, slug: entry.slug?.[1] }));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> => {
  const { slug, lang } = await params;
  const page = adaptersSource.getPage(["vendor-official", slug], lang);

  if (!page) {
    return {};
  }

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: `/${lang}/adapters/vendor-official/${slug}/og`,
    },
    twitter: {
      card: "summary_large_image",
    },
  };
};

export default Page;
