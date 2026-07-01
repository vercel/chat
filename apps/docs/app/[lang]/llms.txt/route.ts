import type { Item, Node, Root } from "fumadocs-core/page-tree";
import type { NextRequest } from "next/server";
import type { ReactNode } from "react";
import { title } from "@/geistdocs";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { source } from "@/lib/geistdocs/source";

export const revalidate = false;

const baseUrl = "https://chat-sdk.dev";

const DESCRIPTION =
  "A unified TypeScript SDK for building chat bots and agents across Slack, Microsoft Teams, Google Chat, Discord, Telegram, WhatsApp, and more — with type-safe handlers, JSX cards, and AI streaming.";

const DETAILS =
  "This index lists the documentation pages in plain markdown. Each link points to the markdown version of a page. For the full text of every page concatenated into a single file, see the llms-full.txt link under Optional.";

const getName = (name: ReactNode): string =>
  typeof name === "string" ? name : "";

const renderItem = (
  item: Item,
  descriptionByUrl: Map<string, string | undefined>
): string => {
  const url = `${baseUrl}${item.url}.md`;
  const description = descriptionByUrl.get(item.url);
  const label = getName(item.name);
  return description
    ? `- [${label}](${url}): ${description}`
    : `- [${label}](${url})`;
};

type Section = { name: string; items: Item[] };

const collectItems = (node: Node, out: Item[]) => {
  if (node.type === "page") {
    out.push(node);
    return;
  }
  if (node.type === "folder") {
    if (node.index) {
      out.push(node.index);
    }
    for (const child of node.children) {
      collectItems(child, out);
    }
  }
};

/**
 * Build sections from a tree whose top-level children are separators (docs):
 * each separator starts a new section, pages/folders fall under it.
 */
const sectionsFromSeparators = (root: Root): Section[] => {
  const sections: Section[] = [];
  let current: Section = {
    name: getName(root.name) || "Documentation",
    items: [],
  };
  sections.push(current);

  for (const node of root.children) {
    if (node.type === "separator") {
      current = { name: getName(node.name), items: [] };
      sections.push(current);
    } else {
      collectItems(node, current.items);
    }
  }

  return sections;
};

/**
 * Build sections from a tree whose top-level children are folders (adapters):
 * each folder becomes a section, flattening its nested separators/pages.
 */
const sectionsFromFolders = (root: Root): Section[] => {
  const sections: Section[] = [];

  for (const node of root.children) {
    if (node.type !== "folder") {
      continue;
    }
    const items: Item[] = [];
    if (node.index) {
      items.push(node.index);
    }
    for (const child of node.children) {
      collectItems(child, items);
    }
    sections.push({ name: getName(node.name), items });
  }

  return sections;
};

export const GET = async (
  _req: NextRequest,
  { params }: RouteContext<"/[lang]/llms.txt">
) => {
  const { lang } = await params;
  const descriptionByUrl = new Map<string, string | undefined>([
    ...source.getPages(lang).map(
      (page) => [page.url, page.data.description] as const
    ),
    ...adaptersSource.getPages(lang).map(
      (page) => [page.url, page.data.description] as const
    ),
  ]);

  const sections = [
    ...sectionsFromSeparators(source.pageTree[lang]),
    ...sectionsFromFolders(adaptersSource.pageTree[lang]),
  ];

  const lines: string[] = [`# ${title}`, "", `> ${DESCRIPTION}`, "", DETAILS];

  for (const section of sections) {
    if (section.items.length === 0) {
      continue;
    }
    lines.push("", `## ${section.name}`, "");
    for (const item of section.items) {
      lines.push(renderItem(item, descriptionByUrl));
    }
  }

  lines.push(
    "",
    "## Optional",
    "",
    `- [Full documentation](${baseUrl}/llms-full.txt): Every documentation page concatenated into a single file.`,
    `- [Documentation sitemap](${baseUrl}/sitemap.md): Semantic index of every documentation page.`
  );

  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
};
