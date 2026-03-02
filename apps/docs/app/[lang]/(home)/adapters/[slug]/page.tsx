import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import adapters from "@/adapters.json";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { source } from "@/lib/geistdocs/source";

const GITHUB_REPO_PATTERN = /github\.com\/([^/]+)\/([^/]+)/;

const getAdapter = (slug: string) => adapters.find((a) => a.slug === slug);

const getSourcePage = (slug: string, lang: string) => {
  const adapter = getAdapter(slug);
  if (!adapter || adapter.community) {
    return undefined;
  }

  const sourceSlug =
    "sourceSlug" in adapter && adapter.sourceSlug ? adapter.sourceSlug : slug;

  if (adapter.type === "platform") {
    return source.getPage(["adapters", sourceSlug], lang);
  }

  return source.getPage(["state", sourceSlug], lang);
};

const fetchReadme = async (repoUrl: string): Promise<string | undefined> => {
  const match = repoUrl.match(GITHUB_REPO_PATTERN);
  if (!match) {
    return undefined;
  }

  const [, owner, repo] = match;
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;

  const response = await fetch(url, { next: { revalidate: 3600 } });
  if (!response.ok) {
    return undefined;
  }

  return response.text();
};

const AdapterPage = async ({
  params,
}: PageProps<"/[lang]/adapters/[slug]">) => {
  const { slug, lang } = await params;
  const adapter = getAdapter(slug);

  if (!adapter) {
    notFound();
  }

  if (adapter.community && "readme" in adapter && adapter.readme) {
    const readme = await fetchReadme(adapter.readme);

    return (
      <div className="container mx-auto max-w-3xl">
        <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
          <div className="flex items-center gap-3">
            <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
              {adapter.name}
            </h1>
          </div>
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
  }

  const page = getSourcePage(slug, lang);

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;

  return (
    <div className="container mx-auto max-w-3xl">
      <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
        <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
          {page.data.title}
        </h1>
        {page.data.description ? (
          <p className="text-lg text-muted-foreground leading-relaxed">
            {page.data.description}
          </p>
        ) : null}
      </section>
      <article className="fd-body prose dark:prose-invert max-w-none px-4 pb-16">
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </article>
    </div>
  );
};

export const generateStaticParams = () =>
  adapters.map((adapter) => ({ slug: adapter.slug }));

export const generateMetadata = async ({
  params,
}: PageProps<"/[lang]/adapters/[slug]">): Promise<Metadata> => {
  const { slug, lang } = await params;
  const adapter = getAdapter(slug);

  if (!adapter) {
    return {};
  }

  if (!adapter.community) {
    const page = getSourcePage(slug, lang);
    if (page) {
      return {
        title: page.data.title,
        description: page.data.description,
      };
    }
  }

  return {
    title: adapter.name,
    description: adapter.description,
  };
};

export default AdapterPage;
