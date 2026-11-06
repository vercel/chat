/**
 * Markdown output helpers for platforms that show Markdown syntax as typed,
 * such as SMS and Messenger. Run the AST through `unwrapBareLinks`, then
 * pass `literalTextHandlers` to `stringifyMarkdown`, so literal text, line
 * breaks, and bare addresses are sent as written.
 */

import {
  type Content,
  isLinkNode,
  type Root,
  type Text,
  text,
  walkAst,
} from "chat";

/**
 * `stringifyMarkdown` handlers that write text nodes without backslash
 * escapes and hard breaks as a plain newline.
 */
export const literalTextHandlers = {
  text: (node: Text) => node.value,
  break: () => "\n",
};

/**
 * Returns a copy of `ast` in which each link that GFM made from a bare URL,
 * `www.` address, or email address is replaced by the address as text. The
 * address is then sent as written instead of as `<url>` or
 * `[www.example.com](http://www.example.com)`. Links with their own label
 * stay links, and `ast` itself is not changed.
 */
export function unwrapBareLinks(ast: Root): Root {
  // walkAst replaces `children` in place, so work on a copy.
  return walkAst(structuredClone(ast), (node) => {
    const address = bareLinkText(node);
    return address === undefined ? node : text(address);
  });
}

/**
 * Returns the address when `node` is a link whose only child is text that
 * matches the link's URL the way GFM writes a bare address.
 */
function bareLinkText(node: Content): string | undefined {
  if (!isLinkNode(node) || node.children.length !== 1) {
    return;
  }
  const [child] = node.children;
  if (child?.type !== "text") {
    return;
  }
  const { value } = child;
  if (
    node.url === value ||
    node.url === `mailto:${value}` ||
    (value.toLowerCase().startsWith("www.") && node.url === `http://${value}`)
  ) {
    return value;
  }
}
