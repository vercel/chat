/**
 * Email format converter.
 *
 * The adapter speaks markdown internally (via mdast) and renders to HTML +
 * plain-text at send time. The converter exists to satisfy the
 * `Adapter.renderFormatted()` and the host `BaseFormatConverter` contract,
 * but the canonical outbound rendering happens in
 * {@link import("./render").cardToHtml}, {@link import("./render").markdownToHtml},
 * etc. — the adapter pulls those directly when composing an email.
 */

import {
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

/**
 * Email-specific {@link BaseFormatConverter} implementation.
 *
 * Lives mostly to satisfy the {@link Adapter.renderFormatted} contract
 * and the inherited `renderPostable` dispatch logic — the heavy lifting
 * (Card → HTML, markdown → HTML, plain-text fallback) happens directly in
 * {@link cardToHtml}, {@link markdownToHtml}, and {@link cardToPlainText}
 * from `./render`, which the adapter calls without going through this
 * class.
 */
export class EmailFormatConverter extends BaseFormatConverter {
  /**
   * Inbound text bodies are already markdown (or close to it), so the
   * default markdown parser handles them as-is. Quoted reply chevrons,
   * signatures, and other email artefacts are preserved verbatim — strip
   * them in user-land if needed.
   */
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  /**
   * Stringify back to markdown so renderers downstream (e.g. transcripts)
   * see consistent output.
   */
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }
}
