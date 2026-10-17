import type { Node, Root } from "fumadocs-core/page-tree";
import {
  absoluteUrl,
  type BreadcrumbEntry,
  breadcrumbNode,
  jsonLdGraph,
  ORGANIZATION_ID,
  SITE_LANGUAGE,
  SITE_NAME,
  softwareReference,
  WEBSITE_ID,
  webPageNode,
} from "./jsonld";

const DOCS_ROOT: BreadcrumbEntry = { name: "Documentation", url: "/docs" };
const INDEX_FILE_PATTERN = /(^|\/)index\.mdx?$/;

interface DocsPage {
  data: {
    description?: string;
    keywords?: string[];
    lastModified?: Date;
    title?: string;
    type?: string;
  };
  path: string;
  slugs: string[];
  url: string;
}

interface DocsJsonLdInput {
  /** Resolves a parent URL segment to its index page, if one exists. */
  getPage: (slugs: string[]) => DocsPage | undefined;
  /** Open Graph image path for the page. */
  image: string;
  page: DocsPage;
  tree: Root;
}

const nodeName = (name: unknown): string | undefined =>
  typeof name === "string" && name.length > 0 ? name : undefined;

/**
 * Map each page URL to its sidebar section: the nearest preceding separator
 * (for example `---API Reference---` in `meta.json`) or the enclosing folder.
 */
const getSidebarSections = (tree: Root): Map<string, string> => {
  const sections = new Map<string, string>();

  const walk = (nodes: Node[], inherited: string | undefined) => {
    let section = inherited;
    for (const node of nodes) {
      if (node.type === "separator") {
        section = nodeName(node.name) ?? section;
      } else if (node.type === "page") {
        if (section) {
          sections.set(node.url, section);
        }
      } else {
        const folderSection = nodeName(node.name) ?? section;
        if (node.index && folderSection) {
          sections.set(node.index.url, folderSection);
        }
        walk(node.children, folderSection);
      }
    }
  };

  walk(tree.children, undefined);
  return sections;
};

const isFolderIndex = (page: DocsPage) =>
  page.slugs.length > 0 && INDEX_FILE_PATTERN.test(page.path);

/**
 * Breadcrumb label for a page. Folder index pages are titled "Overview", so
 * they use their sidebar section name (such as "API Reference") instead.
 */
const getCrumbName = (page: DocsPage, sections: Map<string, string>) =>
  (isFolderIndex(page) ? sections.get(page.url) : undefined) ??
  page.data.title ??
  SITE_NAME;

const getDocsBreadcrumbEntries = (
  page: DocsPage,
  getPage: DocsJsonLdInput["getPage"],
  sections: Map<string, string>
): BreadcrumbEntry[] => {
  const entries = [DOCS_ROOT];

  for (let depth = 1; depth <= page.slugs.length; depth++) {
    const ancestor =
      depth === page.slugs.length ? page : getPage(page.slugs.slice(0, depth));
    if (ancestor) {
      entries.push({
        name: getCrumbName(ancestor, sections),
        url: ancestor.url,
      });
    }
  }

  return entries;
};

/**
 * Build JSON-LD for a documentation page: a `WebPage` whose main entity is a
 * `TechArticle` (or `APIReference` for `type: reference` pages), plus a
 * `BreadcrumbList` that follows the URL hierarchy.
 */
export const getDocsJsonLd = ({
  getPage,
  image,
  page,
  tree,
}: DocsJsonLdInput) => {
  const pageUrl = absoluteUrl(page.url);
  const articleId = `${pageUrl}#article`;
  const imageUrl = absoluteUrl(image);
  const { description, keywords, lastModified, type } = page.data;
  const title = page.data.title ?? SITE_NAME;
  const sections = getSidebarSections(tree);
  const section = sections.get(page.url);
  const isReference = type === "reference";

  const article = {
    "@type": isReference ? "APIReference" : "TechArticle",
    "@id": articleId,
    headline: title,
    ...(description ? { description } : {}),
    url: pageUrl,
    mainEntityOfPage: { "@id": pageUrl },
    image: imageUrl,
    inLanguage: SITE_LANGUAGE,
    author: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    isPartOf: { "@id": WEBSITE_ID },
    about: softwareReference,
    ...(section ? { articleSection: section } : {}),
    ...(keywords?.length ? { keywords } : {}),
    ...(lastModified
      ? { dateModified: new Date(lastModified).toISOString() }
      : {}),
    ...(isReference ? { targetPlatform: "Node.js" } : {}),
  };

  return jsonLdGraph([
    webPageNode({
      description,
      image: imageUrl,
      mainEntityId: articleId,
      name: title,
      url: pageUrl,
    }),
    article,
    breadcrumbNode(
      pageUrl,
      getDocsBreadcrumbEntries(page, getPage, sections)
    ),
  ]);
};
