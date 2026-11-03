import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  isLinkNode,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  type Text,
  text,
  walkAst,
} from "chat";

// Messenger shows Markdown escapes as typed, so literal text and line breaks are
// sent as written.
const handlers = {
  text: (node: Text) => node.value,
  break: () => "\n",
};

/**
 * GFM turns a bare URL, `www.` address, or email address into a link whose
 * text is the address. Returns that address, so it can be sent as written
 * instead of as `<url>` or `[www.example.com](http://www.example.com)`.
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
    (value.startsWith("www.") && node.url === `http://${value}`)
  ) {
    return value;
  }
}

export class MessengerFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      const address = bareLinkText(node);
      return address === undefined ? node : text(address);
    });
    return stringifyMarkdown(transformed, { handlers }).trim();
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return super.renderPostable(message);
  }
}
