import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SiGithub } from "@icons-pack/react-simple-icons";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import adapters from "@/adapters.json";
import { ReadmeContent } from "../components/readme-content";

const LOCAL_PACKAGE_PATTERN = /github\.com\/vercel\/chat\/tree\/[^/]+\/(.+)/;
const GITHUB_REPO_PATTERN = /github\.com\/([^/]+)\/([^/]+)/;

const getAdapter = (slug: string) => adapters.find((a) => a.slug === slug);

const getReadme = async (repoUrl: string): Promise<string | undefined> => {
  const localMatch = repoUrl.match(LOCAL_PACKAGE_PATTERN);
  if (localMatch) {
    const [, pkgPath] = localMatch;
    const filePath = join(process.cwd(), "..", "..", pkgPath, "README.md");
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return undefined;
    }
  }

  const repoMatch = repoUrl.match(GITHUB_REPO_PATTERN);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    const url = `https://api.github.com/repos/${owner}/${repo}/readme`;
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github.raw+json" },
      next: { revalidate: 3600 },
    });
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

  const readme = await getReadme(adapter.readme);

  return (
    <div className="container mx-auto max-w-3xl">
      {readme ? (
        <article className="relative max-w-none px-4 py-16">
          <a
            aria-label="View on GitHub"
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
        <div className="px-4 py-16">
          <h1 className="mb-4 font-bold text-2xl">{adapter.name}</h1>
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
  };
};

export default AdapterPage;
