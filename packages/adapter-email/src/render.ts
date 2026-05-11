/**
 * HTML and plain-text rendering for outbound emails.
 *
 * Two pipelines live here:
 *
 * 1. {@link astToHtml} / {@link markdownToHtml} — render mdast to inline-styled
 *    email-safe HTML. We hand-roll a small walker rather than pulling in
 *    `remark-html` + `@react-email/components` because email layout
 *    requirements are narrow (no client-side state, no CSS classes,
 *    inline styles, table-based layouts) and a custom walker keeps the
 *    package lean and matches how peer adapters (WhatsApp, Telegram) avoid
 *    heavy framework deps.
 *
 * 2. {@link cardToHtml} / {@link cardToPlainText} — render `CardElement` to
 *    HTML and a plain-text fallback. Buttons render as anchor tags driven
 *    by `callbackUrl` (chat-sdk rewrites button values to `__cb:<token>`
 *    before the adapter sees them; if there's no `callbackUrl` the button
 *    becomes a `<button disabled>` to communicate intent).
 */

import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  Content,
  DividerElement,
  FieldElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  LinkElement,
  Root,
  SectionElement,
  TableElement,
  TextElement,
} from "chat";
import {
  cardChildToFallbackText,
  getNodeChildren,
  getNodeValue,
  isTableNode,
  parseMarkdown,
} from "chat";

// =============================================================================
// HTML escaping
// =============================================================================

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing actual control chars from URLs
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/g;

/**
 * Escape a string for safe embedding in HTML.
 *
 * Always called on user-controlled content (markdown bodies, card text,
 * subjects) before injection into the rendered template.
 */
export function escapeHtml(value: string): string {
  // HTML_ESCAPE_PATTERN only matches characters that exist in
  // HTML_ESCAPE_MAP, so the lookup is guaranteed to return a string.
  return value.replace(
    HTML_ESCAPE_PATTERN,
    (ch) => HTML_ESCAPE_MAP[ch] as string
  );
}

/**
 * Escape a string for safe embedding in an HTML attribute (URL, alt, etc.).
 *
 * URLs are also normalized to drop control characters that would break the
 * surrounding `href="..."`.
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value.replace(CONTROL_CHAR_PATTERN, ""));
}

// =============================================================================
// Markdown / mdast -> HTML
// =============================================================================

/**
 * Convert a markdown string to HTML.
 */
export function markdownToHtml(markdown: string): string {
  return astToHtml(parseMarkdown(markdown));
}

/**
 * Convert an mdast `Root` to HTML.
 */
export function astToHtml(root: Root): string {
  const parts: string[] = [];
  for (const node of root.children) {
    parts.push(nodeToHtml(node as Content));
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * Render a single mdast {@link Content} node to HTML. Dispatches on
 * `node.type`; unknown types fall through to a children traversal so
 * future mdast additions degrade gracefully.
 */
function nodeToHtml(node: Content): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${childrenToHtml(node)}</p>`;
    case "heading": {
      const level = Math.min(Math.max(node.depth ?? 1, 1), 6);
      return `<h${level}>${childrenToHtml(node)}</h${level}>`;
    }
    case "thematicBreak":
      return "<hr />";
    case "blockquote":
      return `<blockquote>${childrenToHtml(node)}</blockquote>`;
    case "list":
      return listToHtml(node);
    case "code":
      return `<pre><code${
        node.lang ? ` class="language-${escapeAttr(node.lang)}"` : ""
      }>${escapeHtml(getNodeValue(node))}</code></pre>`;
    case "inlineCode":
      return `<code>${escapeHtml(getNodeValue(node))}</code>`;
    case "strong":
      return `<strong>${childrenToHtml(node)}</strong>`;
    case "emphasis":
      return `<em>${childrenToHtml(node)}</em>`;
    case "delete":
      return `<del>${childrenToHtml(node)}</del>`;
    case "link":
      return `<a href="${escapeAttr(node.url ?? "")}">${childrenToHtml(node)}</a>`;
    case "image":
      return `<img src="${escapeAttr(node.url ?? "")}" alt="${escapeAttr(
        node.alt ?? ""
      )}" />`;
    case "break":
      return "<br />";
    case "text":
      return escapeHtml(getNodeValue(node));
    case "html":
      // Treat raw HTML embedded in markdown as untrusted text and escape it.
      // This matches the behavior we want for email — bots should not
      // inject arbitrary HTML through user-controlled content.
      return escapeHtml(getNodeValue(node));
    default:
      if (isTableNode(node)) {
        return tableNodeToHtml(node);
      }
      return childrenToHtml(node);
  }
}

function childrenToHtml(node: Content): string {
  return getNodeChildren(node)
    .map((child) => nodeToHtml(child as Content))
    .join("");
}

function listToHtml(node: Content): string {
  // The `list` switch case routes here; mdast guarantees `ordered` and
  // optionally provides `start` (defaulting to 1).
  const listNode = node as Content & {
    ordered?: boolean | null;
    start?: number;
  };
  const ordered = Boolean(listNode.ordered);
  const start = typeof listNode.start === "number" ? listNode.start : 1;
  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
  const items = getNodeChildren(node)
    .map((child) => `<li>${childrenToHtml(child as Content)}</li>`)
    .join("");
  return `<${tag}${startAttr}>${items}</${tag}>`;
}

function tableNodeToHtml(node: Content): string {
  const rows = getNodeChildren(node);
  if (rows.length === 0) {
    return "";
  }
  const tableNode = node as Content & { align?: (string | undefined)[] };
  const align = tableNode.align ?? [];
  const [headerRow, ...bodyRows] = rows;

  // `headerRow` is always defined here because we returned early above
  // when `rows.length === 0`. TypeScript can't see through the destructure.
  const head = `<thead><tr>${getNodeChildren(headerRow as Content)
    .map(
      (cell, i) =>
        `<th${alignAttr(align[i])}>${childrenToHtml(cell as Content)}</th>`
    )
    .join("")}</tr></thead>`;
  const body =
    bodyRows.length > 0
      ? `<tbody>${bodyRows
          .map(
            (row) =>
              `<tr>${getNodeChildren(row)
                .map(
                  (cell, i) =>
                    `<td${alignAttr(align[i])}>${childrenToHtml(
                      cell as Content
                    )}</td>`
                )
                .join("")}</tr>`
          )
          .join("")}</tbody>`
      : "";
  return `<table border="1" cellpadding="6" cellspacing="0">${head}${body}</table>`;
}

function alignAttr(align: string | undefined): string {
  if (!align) {
    return "";
  }
  return ` style="text-align:${escapeAttr(align)}"`;
}

// =============================================================================
// CardElement -> HTML
// =============================================================================

const BUTTON_STYLE_TO_CSS: Record<string, string> = {
  primary:
    "background:#2563eb;color:#fff;border:1px solid #1d4ed8;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600",
  danger:
    "background:#dc2626;color:#fff;border:1px solid #b91c1c;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600",
  default:
    "background:#f3f4f6;color:#111827;border:1px solid #d1d5db;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600",
};

/**
 * Render a {@link CardElement} as inline-styled HTML suitable for email.
 */
export function cardToHtml(card: CardElement): string {
  const parts: string[] = [];
  parts.push(
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:600px">`
  );
  if (card.imageUrl) {
    parts.push(
      `<img src="${escapeAttr(card.imageUrl)}" alt="${escapeAttr(
        card.title ?? ""
      )}" style="max-width:100%;border-radius:8px 8px 0 0;display:block" />`
    );
  }
  parts.push(
    `<div style="border:1px solid #e5e7eb;border-radius:${
      card.imageUrl ? "0 0 8px 8px" : "8px"
    };padding:24px">`
  );
  if (card.title) {
    parts.push(
      `<h2 style="margin:0 0 8px 0;font-size:20px;line-height:1.3">${escapeHtml(
        card.title
      )}</h2>`
    );
  }
  if (card.subtitle) {
    parts.push(
      `<p style="margin:0 0 16px 0;color:#6b7280">${escapeHtml(card.subtitle)}</p>`
    );
  }
  for (const child of card.children) {
    parts.push(cardChildToHtml(child));
  }
  parts.push("</div></div>");
  return parts.filter(Boolean).join("\n");
}

/** Dispatch a `CardChild` to its element-specific renderer. */
function cardChildToHtml(child: CardChild): string {
  switch (child.type) {
    case "text":
      return textElementToHtml(child);
    case "image":
      return imageElementToHtml(child);
    case "divider":
      return dividerElementToHtml(child);
    case "actions":
      return actionsElementToHtml(child);
    case "section":
      return sectionElementToHtml(child);
    case "fields":
      return fieldsElementToHtml(child);
    case "link":
      return linkElementToHtml(child);
    case "table":
      return tableElementToHtml(child);
    default:
      return "";
  }
}

function textStyleToCss(style: TextElement["style"]): string {
  if (style === "bold") {
    return "font-weight:600";
  }
  if (style === "muted") {
    return "color:#6b7280";
  }
  return "";
}

function textElementToHtml(el: TextElement): string {
  const style = textStyleToCss(el.style);
  // Render markdown inside text content for parity with other adapters
  const inner = markdownToHtml(el.content);
  if (style) {
    return `<div style="${style};margin-bottom:12px">${inner}</div>`;
  }
  return `<div style="margin-bottom:12px">${inner}</div>`;
}

function imageElementToHtml(el: ImageElement): string {
  return `<p style="margin:0 0 12px 0"><img src="${escapeAttr(
    el.url
  )}" alt="${escapeAttr(el.alt ?? "")}" style="max-width:100%;border-radius:6px" /></p>`;
}

function dividerElementToHtml(_el: DividerElement): string {
  return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />`;
}

/**
 * Render an `Actions` container. Selects and radio selects are not
 * actionable in email and are dropped; if every child is dropped the
 * whole wrapper is omitted.
 */
function actionsElementToHtml(el: ActionsElement): string {
  const buttons = el.children
    .map((child) => {
      switch (child.type) {
        case "button":
          return buttonElementToHtml(child);
        case "link-button":
          return linkButtonElementToHtml(child);
        default:
          // Selects/radio selects are not interactive in email - skip.
          return "";
      }
    })
    .filter(Boolean)
    .join(" ");
  if (!buttons) {
    return "";
  }
  return `<div style="margin:16px 0">${buttons}</div>`;
}

function buttonElementToHtml(el: ButtonElement): string {
  const style = BUTTON_STYLE_TO_CSS[el.style ?? "default"] ?? "";
  if (el.callbackUrl) {
    // chat-sdk has already rewritten button.value to a callback token by
    // the time the adapter sees the postable. We render an anchor that
    // GETs the callback URL with the actionId and value as query params.
    const url = new URL(el.callbackUrl);
    url.searchParams.set("actionId", el.id);
    if (el.value !== undefined) {
      url.searchParams.set("value", el.value);
    }
    return `<a href="${escapeAttr(url.toString())}" style="${style}">${escapeHtml(
      el.label
    )}</a>`;
  }
  // Without a callbackUrl, the button can't do anything actionable in
  // email. Render a disabled-styled span so the intent is preserved.
  return `<span style="${style};opacity:0.5;cursor:not-allowed">${escapeHtml(
    el.label
  )}</span>`;
}

function linkButtonElementToHtml(el: LinkButtonElement): string {
  const style = BUTTON_STYLE_TO_CSS[el.style ?? "default"] ?? "";
  return `<a href="${escapeAttr(el.url)}" style="${style}">${escapeHtml(
    el.label
  )}</a>`;
}

function sectionElementToHtml(el: SectionElement): string {
  return `<div style="margin-bottom:16px">${el.children
    .map((child) => cardChildToHtml(child))
    .join("\n")}</div>`;
}

function fieldsElementToHtml(el: FieldsElement): string {
  const cells = el.children.map((field) => fieldElementToHtml(field)).join("");
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0"><tbody><tr>${cells}</tr></tbody></table>`;
}

function fieldElementToHtml(el: FieldElement): string {
  return `<td style="vertical-align:top;padding:0 12px 0 0"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${escapeHtml(
    el.label
  )}</div><div>${escapeHtml(el.value)}</div></td>`;
}

function linkElementToHtml(el: LinkElement): string {
  return `<p style="margin:0 0 12px 0"><a href="${escapeAttr(el.url)}">${escapeHtml(
    el.label
  )}</a></p>`;
}

function tableElementToHtml(el: TableElement): string {
  const align = el.align ?? [];
  const head = `<thead><tr>${el.headers
    .map(
      (h, i) => `<th style="${headerCellStyle(align[i])}">${escapeHtml(h)}</th>`
    )
    .join("")}</tr></thead>`;
  const body = `<tbody>${el.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, i) =>
              `<td style="${bodyCellStyle(align[i])}">${escapeHtml(cell)}</td>`
          )
          .join("")}</tr>`
    )
    .join("")}</tbody>`;
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0">${head}${body}</table>`;
}

const TABLE_HEADER_BASE_STYLE = "padding:8px;border-bottom:1px solid #e5e7eb";
const TABLE_BODY_BASE_STYLE = "padding:8px;border-bottom:1px solid #f3f4f6";

/**
 * Build the inline `style` value for a table header cell as a single
 * attribute. Emitting alignment as a separate `style="..."` attribute
 * would shadow these declarations — per the HTML spec, browsers keep
 * the first `style` attribute on a tag and silently drop any later ones.
 */
function headerCellStyle(align: string | undefined): string {
  return `${TABLE_HEADER_BASE_STYLE};text-align:${escapeAttr(align ?? "left")}`;
}

/**
 * Build the inline `style` value for a table body cell. Alignment is
 * only emitted when explicitly set; `<td>` defaults to `text-align:left`
 * already.
 */
function bodyCellStyle(align: string | undefined): string {
  if (!align) {
    return TABLE_BODY_BASE_STYLE;
  }
  return `${TABLE_BODY_BASE_STYLE};text-align:${escapeAttr(align)}`;
}

// =============================================================================
// Plain-text fallback
// =============================================================================

/**
 * Render a {@link CardElement} as plain text using the chat-sdk's
 * canonical fallback formatter.
 *
 * Email clients without HTML rendering (or in plain-text mode) see this
 * version. Action buttons are excluded from the text fallback because they
 * are not actionable; link buttons collapse to "label (url)".
 */
export function cardToPlainText(card: CardElement): string {
  const parts: string[] = [];
  if (card.title) {
    parts.push(card.title);
  }
  if (card.subtitle) {
    parts.push(card.subtitle);
  }
  for (const child of card.children) {
    const text = cardChildToText(child);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

/**
 * Plain-text version of {@link cardChildToHtml}. Returns `null` for
 * children that don't contribute any meaningful text (e.g. action
 * containers with no actionable URLs).
 */
function cardChildToText(child: CardChild): string | null {
  switch (child.type) {
    case "actions": {
      // Include only link-buttons (since action buttons need a callback URL
      // to be useful in email — those still degrade to label-only here).
      const lines = child.children
        .map((c) => {
          if (c.type === "link-button") {
            return `- ${c.label}: ${c.url}`;
          }
          if (c.type === "button" && c.callbackUrl) {
            const url = new URL(c.callbackUrl);
            url.searchParams.set("actionId", c.id);
            if (c.value !== undefined) {
              url.searchParams.set("value", c.value);
            }
            return `- ${c.label}: ${url.toString()}`;
          }
          return null;
        })
        .filter(Boolean);
      return lines.length > 0 ? lines.join("\n") : null;
    }
    case "section":
      return child.children
        .map((c) => cardChildToText(c))
        .filter(Boolean)
        .join("\n");
    default:
      return cardChildToFallbackText(child);
  }
}
