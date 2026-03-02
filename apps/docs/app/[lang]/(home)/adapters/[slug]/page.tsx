import { SiGithub } from "@icons-pack/react-simple-icons";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import adapters from "@/adapters.json";
import { ReadmeContent } from "../components/readme-content";

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
      {readme ? (
        <article className="relative max-w-none px-4 py-16">
          <a
            className="absolute top-18 right-4"
            href={adapter.readme}
            rel="noopener noreferrer"
            target="_blank"
          >
            <SiGithub className="size-6" />
          </a>
          <ReadmeContent>{readme}</ReadmeContent>
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
