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
type Fits = (root: Root) => boolean;
type Wrap = (node: Nodes) => Root;

// Only break at a separator when it keeps at least this share of the
// budget; otherwise a far-back newline would produce a tiny part.
const MIN_BOUNDARY_RATIO = 0.5;
const SEPARATORS = ["\n\n", "\n", " "] as const;

/**
 * Split `root` into ordered roots that each satisfy `fits`.
 *
 * Top-level blocks are packed greedily. A block that does not fit on its own
 * is split by its children, recursively, and text or code values are split at
 * paragraph, line, or word boundaries. A part is always wrapped in copies of
 * its ancestors, so a split bold run or code block is reopened in the next
 * part. A node that cannot be split further and still does not fit (for
 * example an image with a huge URL) is emitted on its own.
 */
export function splitMarkdownAst(root: Root, fits: Fits): Root[] {
  if (fits(root)) {
    return [root];
  }
  return splitChildren(root, (node) => node as Root, fits) as Root[];
}

/**
 * Split a plain string into ordered parts that each satisfy `fits`, breaking
 * at paragraph, line, or word boundaries when possible.
 */
export function splitText(
  value: string,
  fits: (value: string) => boolean
): string[] {
  const parts: string[] = [];
  let rest = value;

  while (rest.length > 0) {
    if (fits(rest)) {
      parts.push(rest);
      break;
    }

    const max = largestFitting(rest.length - 1, (length) =>
      fits(rest.slice(0, length))
    );
    if (max === 0) {
      // Not even one character fits inside the surrounding markup.
      parts.push(rest);
      break;
    }

    const { end, next } = findBreak(rest, max);
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

function findBreak(value: string, max: number): { end: number; next: number } {
  const minimum = Math.floor(max * MIN_BOUNDARY_RATIO);
  for (const separator of SEPARATORS) {
    const index = value.lastIndexOf(separator, max);
    if (index > 0 && index >= minimum) {
      return { end: index, next: index + separator.length };
    }
  }

  // Hard break, without separating a surrogate pair.
  const code = value.charCodeAt(max - 1);
  const end = code >= 0xd8_00 && code <= 0xdb_ff && max > 1 ? max - 1 : max;
  return { end, next: end };
}

function splitNode(node: Nodes, wrap: Wrap, fits: Fits): Nodes[] {
  if ("children" in node && node.children.length > 0) {
    return splitChildren(node, wrap, fits);
  }
  if ("value" in node && typeof node.value === "string") {
    const valueNode = node as ValueNode;
    return splitText(valueNode.value, (value) =>
      fits(wrap({ ...valueNode, value } as Nodes))
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

function splitChildren(node: ParentNode, wrap: Wrap, fits: Fits): Nodes[] {
  const children = node.children as Nodes[];
  const pieces: Nodes[] = [];

  const fitsWith = (items: Nodes[], firstIndex: number): boolean =>
    fits(wrap(withChildren(node, items, firstIndex)));

  let index = 0;
  while (index < children.length) {
    const start = index;
    const count = largestFitting(children.length - start, (n) =>
      fitsWith(children.slice(start, start + n), start)
    );
    if (count > 0) {
      pieces.push(
        withChildren(node, children.slice(start, start + count), start)
      );
      index += count;
      continue;
    }

    // The child does not fit on its own, so split it.
    const child = children[start] as Nodes;
    const childPieces = splitNode(
      child,
      (piece) => wrap(withChildren(node, [piece], start)),
      fits
    );
    for (const piece of childPieces.slice(0, -1)) {
      pieces.push(withChildren(node, [piece], start));
    }

    // The last piece may still share a part with the following siblings.
    const last = childPieces.at(-1) as Nodes;
    const extra = largestFitting(children.length - start - 1, (n) =>
      fitsWith([last, ...children.slice(start + 1, start + 1 + n)], start)
    );
    pieces.push(
      withChildren(
        node,
        [last, ...children.slice(start + 1, start + 1 + extra)],
        start
      )
    );
    index = start + 1 + extra;
  }

  return pieces;
}
