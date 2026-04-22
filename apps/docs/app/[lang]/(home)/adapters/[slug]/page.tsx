import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import adapters from "@/adapters.json";
import { ReadmeContent } from "../components/readme-content";

const LOCAL_PACKAGE_PATTERN = /github\.com\/vercel\/chat\/tree\/[^/]+\/(.+)/;
const GITHUB_SUBPATH_PATTERN =
  /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/;
const GITHUB_REPO_REF_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?$/;
const GITHUB_REPO_PATTERN = /github\.com\/([^/]+)\/([^/]+)/;
const GITHUB_REPO_ROOT_PATTERN = /^(https:\/\/github\.com\/[^/]+\/[^/]+)/;

const UNPINNED_REF_PATTERN = /^(main|master|head|dev|develop|trunk|default)$/i;

const MAX_README_BYTES = 500_000;

type Adapter = (typeof adapters)[number];

const getAdapter = (slug: string) => adapters.find((a) => a.slug === slug);

const isCommunity = (adapter: Adapter): boolean =>
  "community" in adapter && adapter.community === true;

const isVendorOfficial = (adapter: Adapter): boolean =>
  "vendorOfficial" in adapter && adapter.vendorOfficial === true;

const getAuthor = (adapter: Adapter): string | undefined =>
  "author" in adapter ? adapter.author : undefined;

const getIssuesUrl = (readmeUrl: string | undefined): string | undefined => {
  if (!readmeUrl) {
    return undefined;
  }
  const match = readmeUrl.match(GITHUB_REPO_ROOT_PATTERN);
  return match ? `${match[1]}/issues` : undefined;
};

const warnUnpinned = (adapter: Adapter, ref: string | undefined) => {
  if (!isCommunity(adapter)) {
    return;
  }
  if (ref && !UNPINNED_REF_PATTERN.test(ref)) {
    return;
  }
  console.warn(
    `[adapters] Community adapter "${adapter.name}" uses an unpinned README ref "${ref ?? "<default branch>"}". Pin to a commit SHA or tag in adapters.json to freeze content at review time.`
  );
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
  return undefined;
};

const getReadme = async (adapter: Adapter): Promise<string | undefined> => {
  if (!adapter.readme) {
    return undefined;
  }
  const repoUrl = adapter.readme;

  const localMatch = repoUrl.match(LOCAL_PACKAGE_PATTERN);
  if (localMatch) {
    const [, pkgPath] = localMatch;
    const filePath = join(process.cwd(), "..", "..", pkgPath, "README.md");
    try {
      return truncate(await readFile(filePath, "utf-8"));
    } catch {
      return undefined;
    }
  }

  const subpathMatch = repoUrl.match(GITHUB_SUBPATH_PATTERN);
  if (subpathMatch) {
    const [, owner, repo, ref, path] = subpathMatch;
    warnUnpinned(adapter, ref);
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme/${path}?ref=${ref}`
    );
    return content ? truncate(content) : undefined;
  }

  const repoRefMatch = repoUrl.match(GITHUB_REPO_REF_PATTERN);
  if (repoRefMatch) {
    const [, owner, repo, ref] = repoRefMatch;
    warnUnpinned(adapter, ref);
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme?ref=${ref}`
    );
    return content ? truncate(content) : undefined;
  }

  const repoMatch = repoUrl.match(GITHUB_REPO_PATTERN);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    warnUnpinned(adapter, undefined);
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme`
    );
    return content ? truncate(content) : undefined;
  }

  return undefined;
};

const CommunityNotice = ({ adapter }: { adapter: Adapter }) => {
  if (!isCommunity(adapter)) {
    return null;
  }
  const issuesUrl = getIssuesUrl(adapter.readme);
  const author = getAuthor(adapter);
  const vendorOfficial = isVendorOfficial(adapter) && author;

  return (
    <div className="mb-8 rounded-md border bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
      {vendorOfficial ? (
        <>
          <strong className="text-foreground">Vendor-official adapter</strong>{" "}
          maintained by {author}, not Vercel or Chat SDK contributors. For
          feature requests, bug reports, and support,{" "}
        </>
      ) : (
        <>
          <strong className="text-foreground">Community adapter.</strong> Not
          maintained by Vercel or Chat SDK contributors. For feature requests,
          bug reports, and support,{" "}
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

const AdapterPage = async ({
  params,
}: PageProps<"/[lang]/adapters/[slug]">) => {
  const { slug } = await params;
  const adapter = getAdapter(slug);

  if (!adapter?.readme) {
    notFound();
  }

  const readme = await getReadme(adapter);

  return (
    <div className="container mx-auto max-w-3xl">
      {readme ? (
        <article className="relative max-w-none px-4 py-16">
          <div className="mb-6 flex items-center justify-between">
            <Link
              className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
              href="/adapters"
            >
              <ArrowLeftIcon className="size-4" />
              All Adapters
            </Link>
            <a
              aria-label="View on GitHub"
              className="text-muted-foreground hover:text-foreground"
              href={adapter.readme}
              rel="noopener noreferrer"
              target="_blank"
            >
              <SiGithub className="size-6" />
            </a>
          </div>
          <CommunityNotice adapter={adapter} />
          <ReadmeContent>{readme}</ReadmeContent>
        </article>
      ) : (
        <div className="px-4 py-16">
          <Link
            className="mb-6 inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
            href="/adapters"
          >
            <ArrowLeftIcon className="size-4" />
            All Adapters
          </Link>
          <h1 className="mb-4 font-bold text-2xl">{adapter.name}</h1>
          <CommunityNotice adapter={adapter} />
          <p className="text-muted-foreground">
            README not available. Visit the{" "}
            <a
              className="text-primary underline"
              href={adapter.readme}
              rel="noopener noreferrer"
              target="_blank"
            >
              GitHub repository
            </a>{" "}
            for documentation.
          </p>
        </div>
      )}
    </div>
  );
};

export const generateStaticParams = () =>
  adapters
    .filter((adapter) => "readme" in adapter)
    .map((adapter) => ({ slug: adapter.slug }));

export const generateMetadata = async ({
  params,
}: PageProps<"/[lang]/adapters/[slug]">): Promise<Metadata> => {
  const { slug } = await params;
  const adapter = getAdapter(slug);

  if (!adapter) {
    return {};
  }

  return {
    title: adapter.name,
    description: adapter.description,
    openGraph: {
      images: `/en/adapters/${slug}/og`,
    },
  };
};

export default AdapterPage;
