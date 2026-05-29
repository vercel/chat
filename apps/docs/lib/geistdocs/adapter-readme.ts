import { readFile } from "node:fs/promises";
import { join } from "node:path";
import adaptersJson from "@/adapters.json";

const LOCAL_PACKAGE_PATTERN = /github\.com\/vercel\/chat\/tree\/[^/]+\/(.+)/;
const GITHUB_SUBPATH_PATTERN =
  /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/;
const GITHUB_REPO_REF_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?$/;
const GITHUB_REPO_PATTERN = /github\.com\/([^/]+)\/([^/]+)/;
const GITHUB_REPO_ROOT_PATTERN = /^(https:\/\/github\.com\/[^/]+\/[^/]+)/;
const UNPINNED_REF_PATTERN = /^(main|master|head|dev|develop|trunk|default)$/i;

const MAX_README_BYTES = 500_000;

export type Adapter = (typeof adaptersJson)[number];

export const getAdapter = (slug: string): Adapter | undefined =>
  adaptersJson.find((a) => a.slug === slug);

export const getAuthor = (adapter: Adapter): string | undefined =>
  "author" in adapter ? adapter.author : undefined;

export const getIssuesUrl = (
  readmeUrl: string | undefined
): string | undefined => {
  if (!readmeUrl) {
    return;
  }
  const match = readmeUrl.match(GITHUB_REPO_ROOT_PATTERN);
  return match ? `${match[1]}/issues` : undefined;
};

const warnUnpinned = (adapter: Adapter, ref: string | undefined) => {
  if (ref && !UNPINNED_REF_PATTERN.test(ref)) {
    return;
  }
  console.warn(
    `[adapters] Community adapter "${adapter.name}" uses an unpinned README ref "${
      ref ?? "<default branch>"
    }". Pin to a commit SHA or tag in adapters.json to freeze content at review time.`
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
};

interface GetReadmeOptions {
  /** Emit a build-time warning when the README ref is not pinned to a SHA/tag. */
  warnOnUnpinnedRef?: boolean;
}

export const getReadme = async (
  adapter: Adapter,
  options: GetReadmeOptions = {}
): Promise<string | undefined> => {
  if (!adapter.readme) {
    return;
  }
  const repoUrl = adapter.readme;
  const warn = options.warnOnUnpinnedRef ?? false;

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
    if (warn) {
      warnUnpinned(adapter, ref);
    }
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme/${path}?ref=${ref}`
    );
    return content ? truncate(content) : undefined;
  }

  const repoRefMatch = repoUrl.match(GITHUB_REPO_REF_PATTERN);
  if (repoRefMatch) {
    const [, owner, repo, ref] = repoRefMatch;
    if (warn) {
      warnUnpinned(adapter, ref);
    }
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme?ref=${ref}`
    );
    return content ? truncate(content) : undefined;
  }

  const repoMatch = repoUrl.match(GITHUB_REPO_PATTERN);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    if (warn) {
      warnUnpinned(adapter, undefined);
    }
    const content = await fetchGitHubReadme(
      `https://api.github.com/repos/${owner}/${repo}/readme`
    );
    return content ? truncate(content) : undefined;
  }
};
