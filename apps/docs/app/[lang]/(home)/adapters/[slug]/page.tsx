import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import adapters from "@/adapters.json";

const GITHUB_TREE_PATTERN = /github\.com\/([^/]+)\/([^/]+)\/tree\/[^/]+\/(.+)/;
const GITHUB_REPO_PATTERN = /github\.com\/([^/]+)\/([^/]+)/;

const getAdapter = (slug: string) => adapters.find((a) => a.slug === slug);

const fetchReadme = async (repoUrl: string): Promise<string | undefined> => {
  const treeMatch = repoUrl.match(GITHUB_TREE_PATTERN);
  if (treeMatch) {
    const [, owner, repo, path] = treeMatch;
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}/README.md`;
    const response = await fetch(url, { next: { revalidate: 3600 } });
    if (response.ok) {
      return response.text();
    }
    return undefined;
  }

  const repoMatch = repoUrl.match(GITHUB_REPO_PATTERN);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
    const response = await fetch(url, { next: { revalidate: 3600 } });
    if (response.ok) {
      return response.text();
    }
  }

  return undefined;
};

const AdapterPage = async ({
  params,
}: PageProps<"/[lang]/adapters/[slug]">) => {
  const { slug } = await params;
  const adapter = getAdapter(slug);

  if (!adapter?.readme) {
    notFound();
  }

  const readme = await fetchReadme(adapter.readme);

  return (
    <div className="container mx-auto max-w-3xl">
      <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
        <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
          {adapter.name}
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          {adapter.description}
        </p>
        <div className="flex items-center gap-3 text-muted-foreground text-sm">
          <code>{adapter.packageName}</code>
          <span>&middot;</span>
          <a
            className="text-primary underline"
            href={adapter.readme}
            rel="noopener noreferrer"
            target="_blank"
          >
            View on GitHub
          </a>
        </div>
      </section>
      {readme ? (
        <article className="prose dark:prose-invert max-w-none px-4 pb-16">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
        </article>
      ) : (
        <p className="px-4 pb-16 text-muted-foreground">
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
      )}
    </div>
  );
};

export const generateStaticParams = () =>
  adapters.map((adapter) => ({ slug: adapter.slug }));

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
  };
};

export default AdapterPage;
