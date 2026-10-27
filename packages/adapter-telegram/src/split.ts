/**
 * Split long Telegram messages into ordered parts that each fit a length
 * budget without cutting through formatting.
 *
 * Splitting works on the markdown AST rather than the rendered string, so
 * every part is rendered from a complete subtree and its entities stay
 * balanced in both MarkdownV2 and rich-message markdown.
 */

import type { Nodes, Root } from "chat";

type ParentNode = Extract<Nodes, { children: unknown[] }>;
type ValueNode = Extract<Nodes, { value: string }>;
type DefinitionNode = Extract<
  Nodes,
  { type: "definition" | "footnoteDefinition" }
>;
type Fits = (root: Root) => boolean;
/**
 * Wrap a piece of a node in copies of its ancestors. `first` is set while
 * sizing the first piece the node emits, which shares its part with the
 * siblings packed before it at each ancestor level.
 */
type Wrap = (node: Nodes, first: boolean) => Root;
type Build = (items: Nodes[], firstIndex: number) => Nodes;

interface BreakRules {
  /** Share of the budget a separator must keep to be used. */
  minRatio: number;
  /** Separators to break at, in order of preference. */
  separators: readonly string[];
}

// Text only breaks at a separator that keeps at least half the budget;
// otherwise a far-back newline would produce a tiny part.
const TEXT_BREAKS: BreakRules = {
  minRatio: 0.5,
  separators: ["\n\n", "\n", " "],
};
// Code only breaks between lines, wherever the last fitting newline is. The
// part boundary stands in for the dropped newline.
const CODE_BREAKS: BreakRules = { minRatio: 0, separators: ["\n"] };
const EMOJI_PLACEHOLDER = /\{\{emoji:[a-z0-9_]+\}\}/gi;

/**
 * Split `root` into ordered roots that each satisfy `fits`.
 *
 * Top-level blocks are packed greedily. A block that does not fit on its own
 * is split by its children, recursively, and its first piece shares a part
 * with the blocks packed before it. Text values are split at paragraph, line,
 * or word boundaries, and code at line boundaries. A part is always wrapped in
 * copies of its ancestors, so a split bold run or code block is reopened in
 * the next part. A node that cannot be split further and still does not fit
 * (for example an image with a huge URL) is emitted on its own.
 *
 * Reference definitions are moved to the end of every part that references
 * them, so a reference never ends up in a different part from its definition.
 */
export function splitMarkdownAst(root: Root, fits: Fits): Root[] {
  if (fits(root)) {
    return [root];
  }

  const definitions: DefinitionNode[] = [];
  const stripped = (stripDefinitions(root, definitions) ?? root) as Root;
  if (definitions.length === 0) {
    return splitRoot(root, fits);
  }
  const withDefinitions = definitionAppender(definitions);
  return splitRoot(stripped, (part) => fits(withDefinitions(part))).map(
    withDefinitions
  );
}

/**
 * Split a plain string into ordered parts that each satisfy `fits`, breaking
 * at paragraph, line, or word boundaries when possible.
 */
export function splitText(
  value: string,
  fits: (value: string) => boolean
): string[] {
  return splitValue(value, (part) => fits(part), TEXT_BREAKS);
}

function splitRoot(root: Root, fits: Fits): Root[] {
  const parts = (splitChildren(root, (node) => node as Root, fits) ?? [
    root,
  ]) as Root[];
  const trimmed: Root[] = [];
  for (const part of parts) {
    const start = trimEdgeText(part, "start");
    const both = start && trimEdgeText(start, "end");
    if (both && (both as Root).children.length > 0) {
      trimmed.push(both as Root);
    }
  }
  return trimmed;
}

/**
 * Trim whitespace from the text at the start or end of `node`, copying the
 * path to it. A split between inline nodes can leave a part starting or
 * ending with a space, which rich-message markdown would encode as `&#x20;`.
 * Trimming only shortens a part, so it still fits.
 *
 * Returns `null` when trimming empties the node. An empty text node makes
 * remark-stringify emit `&#xNAN;` before emphasis that starts with
 * punctuation, and an empty paragraph, list item, or blockquote renders a
 * stray marker, so the parent drops it and trims the next edge node. Table
 * cells are kept empty instead, so a row keeps its columns.
 */
function trimEdgeText(node: Nodes, edge: "start" | "end"): Nodes | null {
  if (node.type === "text") {
    const value =
      edge === "start" ? node.value.trimStart() : node.value.trimEnd();
    if (value === node.value) {
      return node;
    }
    return value ? { ...node, value } : null;
  }
  if (!("children" in node) || node.children.length === 0) {
    return node;
  }
  const children = [...node.children] as Nodes[];
  let changed = false;
  while (children.length > 0) {
    const index = edge === "start" ? 0 : children.length - 1;
    const child = children[index] as Nodes;
    const trimmed = trimEdgeText(child, edge);
    if (trimmed === child) {
      break;
    }
    changed = true;
    if (trimmed) {
      children[index] = trimmed;
      break;
    }
    children.splice(index, 1);
  }
  if (!changed) {
    return node;
  }
  if (
    children.length === 0 &&
    node.type !== "root" &&
    node.type !== "tableCell"
  ) {
    return null;
  }
  return { ...node, children } as Nodes;
}

/**
 * Copy `node` without its `definition` and `footnoteDefinition` descendants,
 * collecting them in document order. Subtrees without definitions are reused.
 */
function stripDefinitions(node: Nodes, found: DefinitionNode[]): Nodes | null {
  if (!("children" in node)) {
    return node;
  }
  let changed = false;
  const children: Nodes[] = [];
  for (const child of node.children as Nodes[]) {
    if (child.type === "definition" || child.type === "footnoteDefinition") {
      found.push(child);
      changed = true;
      continue;
    }
    const stripped = stripDefinitions(child, found);
    changed ||= stripped !== child;
    if (stripped) {
      children.push(stripped);
    }
  }
  if (!changed) {
    return node;
  }
  // A container that only held definitions would render as a stray `>` or
  // list marker, so drop it. The root is always kept.
  if (children.length === 0 && node.type !== "root") {
    return null;
  }
  return { ...node, children } as Nodes;
}

/**
 * Returns a function that appends to a part the definitions its references
 * use, including those referenced from a footnote it carries, in document
 * order. Definitions that nothing references render nothing, so they are
 * dropped.
 */
function definitionAppender(
  definitions: DefinitionNode[]
): (part: Root) => Root {
  const links = new Map<string, DefinitionNode>();
  const footnotes = new Map<string, DefinitionNode>();
  for (const definition of definitions) {
    const byId = definition.type === "definition" ? links : footnotes;
    // As in markdown, the first definition of an identifier wins.
    if (!byId.has(definition.identifier)) {
      byId.set(definition.identifier, definition);
    }
  }

  const definitionFor = (node: Nodes): DefinitionNode | undefined => {
    if (node.type === "linkReference" || node.type === "imageReference") {
      return links.get(node.identifier);
    }
    if (node.type === "footnoteReference") {
      return footnotes.get(node.identifier);
    }
    return;
  };

  return (part) => {
    const used = new Set<DefinitionNode>();
    const visit = (node: Nodes): void => {
      const definition = definitionFor(node);
      if (definition && !used.has(definition)) {
        used.add(definition);
        visit(definition);
      }
      if ("children" in node) {
        for (const child of node.children as Nodes[]) {
          visit(child);
        }
      }
    };
    visit(part);
    if (used.size === 0) {
      return part;
    }
    return {
      ...part,
      children: [
        ...part.children,
        ...definitions.filter((definition) => used.has(definition)),
      ],
    } as Root;
  };
}

/**
 * Split `value` into parts that satisfy `fits`. `first` is set while sizing
 * the first part.
 */
function splitValue(
  value: string,
  fits: (value: string, first: boolean) => boolean,
  rules: BreakRules
): string[] {
  const parts: string[] = [];
  let rest = value;

  while (rest.length > 0) {
    const first = parts.length === 0;
    if (fits(rest, first)) {
      parts.push(rest);
      break;
    }

    const max = largestFitting(rest.length - 1, (length) =>
      fits(rest.slice(0, length), first)
    );
    if (max === 0) {
      // Not even one character fits inside the surrounding markup.
      parts.push(rest);
      break;
    }

    const { end, next } = findBreak(rest, max, rules);
    if (end === 0) {
      // What fits would cut the leading placeholder or surrogate pair.
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, end));
    rest = rest.slice(next);
  }

  return parts;
}

/**
 * Largest `n` in `[0, max]` for which `test(n)` holds, assuming `test` is
 * monotonic and `test(0)` holds. Gallops from 1 so each probe stays close to
 * the size of one part instead of the whole remaining message.
 */
function largestFitting(max: number, test: (n: number) => boolean): number {
  if (max < 1 || !test(1)) {
    return 0;
  }
  let low = 1;
  let high = 2;
  while (high <= max && test(high)) {
    low = high;
    high *= 2;
  }
  high = Math.min(high, max + 1);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (test(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

function findBreak(
  value: string,
  max: number,
  rules: BreakRules
): { end: number; next: number } {
  const minimum = Math.floor(max * rules.minRatio);
  for (const separator of rules.separators) {
    const index = value.lastIndexOf(separator, max);
    if (index > 0 && index >= minimum) {
      return { end: index, next: index + separator.length };
    }
  }
  const end = hardBreak(value, max);
  return { end, next: end };
}

/**
 * Break at `max`, moved back so the break separates neither a surrogate pair
 * nor an emoji placeholder. Placeholders are converted after rendering, so a
 * cut one would reach the user as literal text. Returns 0 when the value
 * starts with one that doesn't fit.
 */
function hardBreak(value: string, max: number): number {
  for (const match of value.matchAll(EMOJI_PLACEHOLDER)) {
    if (match.index >= max) {
      break;
    }
    if (max < match.index + match[0].length) {
      return match.index;
    }
  }
  const code = value.charCodeAt(max - 1);
  return code >= 0xd8_00 && code <= 0xdb_ff ? max - 1 : max;
}

function splitNode(node: Nodes, wrap: Wrap, fits: Fits): Nodes[] | null {
  if ("children" in node && node.children.length > 0) {
    return splitChildren(node, wrap, fits);
  }
  if ("value" in node && typeof node.value === "string" && node.value) {
    const valueNode = node as ValueNode;
    return splitValue(
      valueNode.value,
      (value, first) => fits(wrap({ ...valueNode, value } as Nodes, first)),
      node.type === "code" ? CODE_BREAKS : TEXT_BREAKS
    ).map((value) => ({ ...valueNode, value }) as Nodes);
  }
  return [node];
}

function withChildren(
  node: ParentNode,
  children: Nodes[],
  firstIndex: number
): Nodes {
  const copy = { ...node, children } as ParentNode;
  // Keep ordered list numbering continuous across parts.
  if (copy.type === "list" && copy.ordered && node.type === "list") {
    copy.start = (node.start ?? 1) + firstIndex;
  }
  return copy as Nodes;
}

function emptyCell(): Nodes {
  return { type: "tableCell", children: [] } as Nodes;
}

/**
 * Returns how to copy `node` with the children starting at `firstIndex`, and
 * the table header row that every later part repeats, if any.
 */
function pieceBuilder(
  node: ParentNode,
  wrap: Wrap,
  fits: Fits
): { build: Build; header: Nodes | undefined } {
  const children = node.children as Nodes[];

  // Repeat a table's header row in every part, so later parts don't promote
  // their first body row to the header. Skip it when the header can't share a
  // part with any whole body row, since repeating it would split every row
  // apart.
  const [firstChild, ...bodyRows] = children;
  const header =
    node.type === "table" &&
    firstChild &&
    bodyRows.some((row) =>
      fits(wrap(withChildren(node, [firstChild, row], 0), false))
    )
      ? firstChild
      : undefined;

  const build: Build = (items, firstIndex) => {
    if (header && firstIndex > 0) {
      return withChildren(node, [header, ...items], firstIndex);
    }
    if (node.type === "tableRow") {
      // Pad part of a split row with empty cells so each cell stays in its
      // column.
      const after = children.length - firstIndex - items.length;
      return withChildren(
        node,
        [
          ...Array.from({ length: firstIndex }, emptyCell),
          ...items,
          ...Array.from({ length: after }, emptyCell),
        ],
        firstIndex
      );
    }
    return withChildren(node, items, firstIndex);
  };

  return { build, header };
}

/**
 * Split `node` into copies that each hold a run of its children, packing them
 * greedily. A child that does not fit on its own is split, and its first
 * piece is sized together with the children packed before it.
 *
 * Returns `null` when the first piece of `node` is being sized beside an
 * ancestor's packed siblings and its first child only fits in a part of its
 * own. The ancestor then sends those siblings alone instead of splitting a
 * child that didn't need it.
 */
function splitChildren(
  node: ParentNode,
  wrap: Wrap,
  fits: Fits
): Nodes[] | null {
  const children = node.children as Nodes[];
  const { build, header } = pieceBuilder(node, wrap, fits);
  const pieces: Nodes[] = [];
  const fitsAs = (items: Nodes[], firstIndex: number): boolean =>
    fits(wrap(build(items, firstIndex), pieces.length === 0));

  // Children packed into the piece being built, starting at `batchStart`. The
  // first item may be the last piece of a split child.
  let batch: Nodes[] = [];
  let batchStart = 0;
  let index = 0;

  while (index < children.length) {
    const start = batch.length > 0 ? batchStart : index;
    const taken = largestFitting(children.length - index, (n) =>
      fitsAs([...batch, ...children.slice(index, index + n)], start)
    );
    batch = [...batch, ...children.slice(index, index + taken)];
    batchStart = start;
    index += taken;

    const child = children[index];
    if (!child) {
      break;
    }

    if (fits(wrap(build([child], index), false))) {
      // An empty batch, or a lone repeated table header, means only the
      // ancestors' packed siblings keep the child out of this part.
      if (batch.length === 0 || (header && batch.length === 1 && start === 0)) {
        return null;
      }
      pieces.push(build(batch, batchStart));
      batch = [];
      continue;
    }

    const childIndex = index;
    const splitChild = (leading: Nodes[], leadingStart: number) => {
      const first = pieces.length === 0;
      return splitNode(
        child,
        (piece, childFirst) =>
          childFirst
            ? wrap(build([...leading, piece], leadingStart), first)
            : wrap(build([piece], childIndex), false),
        fits
      );
    };

    let childPieces = splitChild(batch, start);
    if (batch.length > 0) {
      const head = childPieces?.[0];
      if (!(head && fitsAs([...batch, head], batchStart))) {
        // Nothing of the child fits beside the batch, so send the batch alone.
        // A lone table header is dropped instead, since `build` repeats it
        // before every later piece.
        if (!(header && batch.length === 1 && batchStart === 0)) {
          pieces.push(build(batch, batchStart));
        }
        batch = [];
        childPieces = splitChild([], childIndex);
      }
    }
    if (!childPieces) {
      return null;
    }

    const [head, ...rest] = childPieces as [Nodes, ...Nodes[]];
    const headStart = batch.length > 0 ? batchStart : childIndex;
    const last = rest.pop();
    if (last) {
      pieces.push(build([...batch, head], headStart));
      for (const piece of rest) {
        pieces.push(build([piece], childIndex));
      }
      batch = [last];
      batchStart = childIndex;
    } else {
      batch = [...batch, head];
      batchStart = headStart;
    }
    index += 1;
  }

  if (batch.length > 0) {
    pieces.push(build(batch, batchStart));
  }
  return pieces;
}
