import type {
  GeistdocsSourceBundle,
  GeistdocsSourcePageData,
} from "@vercel/geistdocs/source";
import { flattenTree, type Node, type Root } from "fumadocs-core/page-tree";

export type DocsSource = GeistdocsSourceBundle["source"];
export type LoaderPage = NonNullable<ReturnType<DocsSource["getPage"]>>;

/**
 * Loader pages with the geistdocs frontmatter fields (`related`,
 * `prerequisites`, `internal`, ...) that the generic fumadocs loader type
 * erases.
 */
export type DocsPage = Omit<LoaderPage, "data"> & {
  data: LoaderPage["data"] & GeistdocsSourcePageData;
};

const CARD_COUNT = 4;

/**
 * Splits the page tree into "runs": contiguous groups of pages bounded by
 * meta.json separators (e.g. `---Usage---`) or folder boundaries. Pages in
 * the same run are treated as section siblings.
 */
export const collectRuns = (root: Root): string[][] => {
  const runs: string[][] = [];
  const walk = (children: Node[], indexUrl?: string) => {
    let current: string[] = indexUrl === undefined ? [] : [indexUrl];
    const closeRun = () => {
      if (current.length > 0) {
        runs.push(current);
      }
      current = [];
    };
    for (const node of children) {
      if (node.type === "page") {
        current.push(node.url);
      } else if (node.type === "separator") {
        closeRun();
      } else {
        walk(node.children, node.index?.url);
      }
    }
    closeRun();
  };
  walk(root.children);
  return runs;
};

/** Returns `urls` reordered to start after `currentUrl`, wrapping around. */
export const rotateAfter = (urls: string[], currentUrl: string): string[] => {
  const index = urls.indexOf(currentUrl);
  if (index === -1) {
    return urls;
  }
  return [...urls.slice(index + 1), ...urls.slice(0, index)];
};

/**
 * Picks the pages to feature in a page's "Read more" section, in priority
 * order: `related` frontmatter, then `prerequisites`, then section siblings
 * (same meta.json run), then the rest of the page tree. Deterministic, and
 * always fills all slots as long as enough pages exist.
 */
export const selectReadMore = (
  source: DocsSource,
  page: LoaderPage,
  count = CARD_COUNT
): DocsPage[] => {
  const lang = page.locale;
  const byUrl = new Map<string, DocsPage>();
  for (const candidate of source.getPages(lang) as DocsPage[]) {
    if (!candidate.data.internal) {
      byUrl.set(candidate.url, candidate);
    }
  }

  const selected: DocsPage[] = [];
  const seen = new Set<string>([page.url]);
  const add = (url: string) => {
    const candidate = byUrl.get(url);
    if (!candidate || seen.has(url) || selected.length >= count) {
      return;
    }
    seen.add(url);
    selected.push(candidate);
  };

  const data = page.data as DocsPage["data"];
  const curated = [...(data.related ?? []), ...(data.prerequisites ?? [])];
  for (const url of curated) {
    if (
      !byUrl.has(url) &&
      url.startsWith("/docs") &&
      process.env.NODE_ENV === "development"
    ) {
      // biome-ignore lint/suspicious/noConsole: dev-only authoring hint
      console.warn(`read-more: ${page.url} references unknown page ${url}`);
    }
    add(url);
  }

  if (selected.length < count) {
    const tree = source.getPageTree(lang);
    const siblings =
      collectRuns(tree).find((run) => run.includes(page.url)) ?? [];
    for (const url of rotateAfter(siblings, page.url)) {
      add(url);
    }
    const allUrls = flattenTree(tree.children).map((item) => item.url);
    for (const url of rotateAfter(allUrls, page.url)) {
      add(url);
    }
  }

  return selected;
};
