/**
 * WhatsApp-specific format conversion using AST-based parsing.
 *
 * WhatsApp uses a markdown-like format with some differences from standard:
 * - Bold: *text* (single asterisk, not double)
 * - Italic: _text_
 * - Strikethrough: ~text~ (single tilde, not double)
 * - Monospace: ```text```
 *
 * @see https://faq.whatsapp.com/539178204879377
 */

import { normalizeCodeFences } from "@chat-adapter/shared";
import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  type Delete,
  type Emphasis,
  isTableNode,
  parseMarkdown,
  type Root,
  type Strong,
  stringifyMarkdown,
  type Text,
  tableToAscii,
  walkAst,
} from "chat";

type Handlers = NonNullable<
  NonNullable<Parameters<typeof stringifyMarkdown>[1]>["handlers"]
>;
type HandleArgs = Parameters<NonNullable<Handlers["text"]>>;
type State = HandleArgs[2];
type Info = HandleArgs[3];

// WhatsApp has no escape syntax, so text stays literal unless it would
// otherwise turn into formatting.
const INLINE_PAIRS = {
  "*": /(?:^|[^\p{L}\p{N}])\*(?=\S).*?\S\*(?![\p{L}\p{N}])/mu,
  _: /(?:^|[^\p{L}\p{N}])_(?=\S).*?\S_(?![\p{L}\p{N}])/mu,
  "~": /(?:^|[^\p{L}\p{N}])~(?=\S).*?\S~(?![\p{L}\p{N}])/mu,
  "`": /(?:^|[^\p{L}\p{N}])`(?=\S).*?\S`(?![\p{L}\p{N}])/mu,
} as const;
const BLOCK_START = /(^|\n)(?:([>*-])|(\d+)\.)(?= )/g;

// Surrounding markers belong to formatting nodes, so they only bound the text.
function boundary(char: string) {
  return char in INLINE_PAIRS ? " " : char;
}

function text(node: Text, _parent: unknown, _state: State, info: Info) {
  const { before, after } = info;
  const context = [boundary(before.slice(-1)), boundary(after.charAt(0))];
  let value = node.value;
  for (const [marker, pair] of Object.entries(INLINE_PAIRS)) {
    const touchesMarker =
      (value.startsWith(marker) && before.slice(-1) in INLINE_PAIRS) ||
      (value.endsWith(marker) && after.charAt(0) in INLINE_PAIRS);
    if (
      touchesMarker ||
      (value.includes(marker) &&
        pair.test(`${context[0]}${value}${context[1]}`))
    ) {
      value = value.replaceAll(marker, `\\${marker}`);
    }
  }
  return value.replace(
    BLOCK_START,
    (match, lead: string, symbol?: string, digits?: string, offset = 0) => {
      if (offset === 0 && lead === "" && before !== "\n") {
        return match;
      }
      return symbol ? `${lead}\\${symbol}` : `${lead}${digits}\\.`;
    }
  );
}

// `peek` keeps lookahead from serializing nested formatting a second time.
function strong(node: Strong, _parent: unknown, state: State, info: Info) {
  return `*${state.containerPhrasing(node, { ...info, before: "*", after: "*" })}*`;
}
strong.peek = () => "*";

function emphasis(node: Emphasis, _parent: unknown, state: State, info: Info) {
  return `_${state.containerPhrasing(node, { ...info, before: "_", after: "_" })}_`;
}
emphasis.peek = () => "_";

function strikethrough(
  node: Delete,
  _parent: unknown,
  state: State,
  info: Info
) {
  return `~${state.containerPhrasing(node, { ...info, before: "~", after: "~" })}~`;
}
strikethrough.peek = () => "~";

const handlers: Handlers = {
  text,
  strong,
  emphasis,
  delete: strikethrough,
  break: () => "\n",
};

export class WhatsAppFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to WhatsApp markdown format.
   *
   * Transforms unsupported nodes (headings, thematic breaks, tables)
   * into WhatsApp-compatible equivalents and renders supported formatting
   * directly in WhatsApp syntax.
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      // Headings -> bold paragraph (flatten nested strong to avoid ***)
      if (node.type === "heading") {
        const heading = node as Content & { children: Content[] };
        const children = heading.children.flatMap((child) =>
          child.type === "strong"
            ? (child as Content & { children: Content[] }).children
            : [child]
        );
        return {
          type: "paragraph",
          children: [{ type: "strong", children }],
        } as Content;
      }
      // Thematic breaks -> text separator
      if (node.type === "thematicBreak") {
        return {
          type: "paragraph",
          children: [{ type: "text", value: "━━━" }],
        } as Content;
      }
      // Tables -> code blocks (same as Telegram)
      if (isTableNode(node)) {
        return {
          type: "code" as const,
          value: tableToAscii(node),
          lang: undefined,
        } as Content;
      }
      return node;
    });
    return stringifyMarkdown(transformed, {
      emphasis: "_",
      bullet: "-",
      handlers,
    }).trim();
  }

  /**
   * Parse WhatsApp markdown into an AST.
   *
   * Normalizes WhatsApp's ``` fences for CommonMark (the text after the
   * opening fence is code, not an info string) and transforms
   * WhatsApp-specific formatting to standard markdown outside the fences,
   * then parses with the standard parser.
   */
  toAst(markdown: string): Root {
    return parseMarkdown(this.toStandardMarkdown(markdown));
  }

  /**
   * Check the budget against the markdown that `toAst` parses, so the checks
   * see the same code fences as the parser. The length limit still applies to
   * the text as delivered.
   */
  protected override exceedsIncomingBudget(markdown: string): boolean {
    return (
      markdown.length > this.maxIncomingParseLength ||
      super.exceedsIncomingBudget(this.toStandardMarkdown(markdown))
    );
  }

  private toStandardMarkdown(markdown: string): string {
    return normalizeCodeFences(markdown, {
      convertText: (text) => this.fromWhatsAppFormat(text),
    });
  }

  /**
   * Render a postable message to WhatsApp-compatible string.
   */
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

  /**
   * Convert WhatsApp format to standard markdown.
   * Converts single-asterisk bold to double-asterisk bold,
   * and single-tilde strikethrough to double-tilde strikethrough.
   *
   * Careful not to convert _italic_ (which is the same in both formats).
   */
  private fromWhatsAppFormat(text: string): string {
    // Convert *bold* to **bold** (single * not preceded/followed by *, no newlines)
    let result = text.replace(
      /(?<!\*)\*(?!\*)([^\n*]+?)(?<!\*)\*(?!\*)/g,
      "**$1**"
    );
    // Convert ~strike~ to ~~strike~~ (single ~ not preceded/followed by ~, no newlines)
    result = result.replace(/(?<!~)~(?!~)([^\n~]+?)(?<!~)~(?!~)/g, "~~$1~~");
    return result;
  }
}
