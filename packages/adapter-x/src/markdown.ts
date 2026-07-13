import {
  BaseFormatConverter,
  type CardElement,
  type Content,
  getNodeChildren,
  getNodeValue,
  isCodeNode,
  isLinkNode,
  isListNode,
  isTableNode,
  isTextNode,
  link,
  paragraph,
  type Root,
  root,
  tableToAscii,
  text,
} from "chat";
import { cardToXText } from "./cards";

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;
const BLOCK_SEPARATOR = /\n{2,}/;

/**
 * Format converter for X.
 *
 * X renders plain text only, so inbound post/DM text is parsed as plain text
 * (never as markdown: `#topic` hashtags and `*emphasis*` would misparse) with
 * URLs promoted to link nodes, and outbound ASTs are flattened to readable
 * plain text.
 */
export class XFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    const blocks = platformText.split(BLOCK_SEPARATOR);
    const paragraphs = blocks
      .filter((block) => block.length > 0)
      .map((block) => paragraph(splitLinks(block)));
    return root(paragraphs);
  }

  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) => this.nodeToText(node));
  }

  protected override cardToFallbackText(card: CardElement): string {
    return cardToXText(card);
  }

  protected nodeToText(node: Content): string {
    if (isTextNode(node)) {
      return getNodeValue(node);
    }
    if (isLinkNode(node)) {
      const label = getNodeChildren(node)
        .map((child) => this.nodeToText(child))
        .join("");
      return label && label !== node.url ? `${label} (${node.url})` : node.url;
    }
    if (isCodeNode(node)) {
      return getNodeValue(node);
    }
    if (isListNode(node)) {
      return this.renderList(node, 0, (child) => this.nodeToText(child), "•");
    }
    if (isTableNode(node)) {
      return tableToAscii(node);
    }
    if (node.type === "break") {
      return "\n";
    }
    if (node.type === "thematicBreak") {
      return "---";
    }
    return this.defaultNodeToText(node, (child) => this.nodeToText(child));
  }
}

function splitLinks(block: string): Content[] {
  const children: Content[] = [];
  let lastIndex = 0;
  for (const match of block.matchAll(URL_PATTERN)) {
    if (match.index > lastIndex) {
      children.push(text(block.slice(lastIndex, match.index)));
    }
    children.push(link(match[0], [text(match[0])]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < block.length) {
    children.push(text(block.slice(lastIndex)));
  }
  return children;
}
