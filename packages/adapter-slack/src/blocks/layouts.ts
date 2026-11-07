import type { SlackBlock } from "./types";

interface LayoutNode {
  alt?: string;
  children?: LayoutNode[];
  content?: string;
  layout?: "stack" | "columns" | "carousel";
  style?: string;
  type: string;
}

const COLUMN_TYPES = new Set(["text", "image", "divider", "fields", "link"]);

/** Render eligible layout hints natively; return null for a vertical fallback. */
export function sectionToNativeLayout<T extends LayoutNode>(
  section: { children: T[]; layout?: LayoutNode["layout"] },
  render: (child: T) => SlackBlock[]
): SlackBlock[] | null {
  if (
    !section.layout ||
    section.layout === "stack" ||
    !section.children.length
  ) {
    return null;
  }
  if (
    section.children.some(
      (child) =>
        child.type !== "section" || (child.layout && child.layout !== "stack")
    )
  ) {
    return null;
  }
  if (section.layout === "columns") {
    // A layout item holds one block. More complex columns keep their content
    // and controls in the existing vertical section representation.
    if (
      section.children.length > 15 ||
      section.children.some(
        (child) =>
          child.children?.length !== 1 ||
          !COLUMN_TYPES.has(child.children[0]?.type ?? "")
      )
    ) {
      return null;
    }
    const blocks = section.children.flatMap(render);
    if (blocks.length !== section.children.length) {
      return null;
    }
    const rows: { items: { block: SlackBlock }[] }[] = [];
    for (let index = 0; index < blocks.length; index += 3) {
      rows.push({
        items: blocks.slice(index, index + 3).map((block) => ({ block })),
      });
    }
    return [{ type: "layout", label: "Columns", rows, fallback: blocks }];
  }
  if (section.children.length > 10) {
    return null;
  }
  const cards: SlackBlock[] = [];
  for (const item of section.children) {
    const card: SlackBlock = { type: "card" };
    for (const child of item.children ?? []) {
      if (child.type === "text") {
        let field = "body";
        if (child.style === "bold") {
          field = "title";
        } else if (child.style === "muted") {
          field = "subtitle";
        }
        const limit = field === "body" ? 200 : 150;
        if (card[field] || !child.content) {
          return null;
        }
        const block = render(child as T)[0];
        const object =
          child.style === "muted"
            ? (block?.elements as unknown[] | undefined)?.[0]
            : block?.text;
        if (
          !object ||
          typeof object !== "object" ||
          !("text" in object) ||
          typeof object.text !== "string" ||
          object.text.length > limit
        ) {
          return null;
        }
        card[field] = object;
      } else if (child.type === "image") {
        if (card.hero_image) {
          return null;
        }
        card.hero_image = render(child as T)[0];
      } else if (child.type === "actions") {
        if (
          card.actions ||
          !child.children?.length ||
          child.children.length > 3 ||
          child.children.some(
            (action) =>
              action.type !== "button" && action.type !== "link-button"
          )
        ) {
          return null;
        }
        card.actions = render(child as T)[0]?.elements;
      } else {
        return null;
      }
    }
    if (!(card.title || card.body || card.hero_image || card.actions)) {
      return null;
    }
    cards.push(card);
  }
  return [{ type: "carousel", elements: cards }];
}

/** Keep new column wrappers from exceeding a budget that the vertical content fits. */
export function flattenOverBudgetLayouts(
  blocks: SlackBlock[],
  budget: number
): SlackBlock[] {
  let count = blocks.length;
  for (const block of blocks) {
    if (block.type !== "layout" || !Array.isArray(block.rows)) {
      continue;
    }
    for (const row of block.rows as unknown[]) {
      if (
        row &&
        typeof row === "object" &&
        "items" in row &&
        Array.isArray(row.items)
      ) {
        count += row.items.length;
      }
    }
  }
  if (count <= budget) {
    return blocks;
  }
  return blocks.flatMap((block) =>
    block.type === "layout" && Array.isArray(block.fallback)
      ? (block.fallback as SlackBlock[])
      : [block]
  );
}
