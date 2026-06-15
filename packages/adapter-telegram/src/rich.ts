import { markdownToPlainText, StreamingMarkdownRenderer } from "chat";
import type {
  TelegramRichBlock,
  TelegramRichCaption,
  TelegramRichCell,
  TelegramRichItem,
  TelegramRichMessage,
  TelegramRichText,
} from "./types";

export const TELEGRAM_RICH_MESSAGE_LIMIT = 32_768;

export function truncateRichMarkdown(markdown: string): string {
  const characters = Array.from(markdown);
  if (characters.length <= TELEGRAM_RICH_MESSAGE_LIMIT) {
    return markdown;
  }

  let end = TELEGRAM_RICH_MESSAGE_LIMIT - 3;
  while (end > 0) {
    const renderer = new StreamingMarkdownRenderer();
    renderer.push(characters.slice(0, end).join(""));
    const rendered = `${renderer.finish()}...`;
    if (Array.from(rendered).length <= TELEGRAM_RICH_MESSAGE_LIMIT) {
      return rendered;
    }
    end -= Array.from(rendered).length - TELEGRAM_RICH_MESSAGE_LIMIT;
  }

  return "...";
}

function text(markdown: TelegramRichText): string {
  if (typeof markdown === "string") {
    return markdown;
  }
  if (Array.isArray(markdown)) {
    return markdown.map(text).join("");
  }

  switch (markdown.type) {
    case "bold":
      return `**${text(markdown.text)}**`;
    case "italic":
      return `_${text(markdown.text)}_`;
    case "underline":
      return `<u>${text(markdown.text)}</u>`;
    case "strikethrough":
      return `~~${text(markdown.text)}~~`;
    case "spoiler":
      return `||${text(markdown.text)}||`;
    case "subscript":
      return `<sub>${text(markdown.text)}</sub>`;
    case "superscript":
      return `<sup>${text(markdown.text)}</sup>`;
    case "marked":
      return `==${text(markdown.text)}==`;
    case "code":
      return `\`${text(markdown.text)}\``;
    case "date_time":
    case "text_mention":
      return text(markdown.text);
    case "bank_card_number":
    case "bot_command":
    case "cashtag":
    case "hashtag":
    case "mention":
      return text(markdown.text);
    case "custom_emoji":
      return markdown.alternative_text;
    case "mathematical_expression":
      return `$${markdown.expression}$`;
    case "url":
      return `[${text(markdown.text)}](${markdown.url})`;
    case "email_address":
      return `[${text(markdown.text)}](mailto:${markdown.email_address})`;
    case "phone_number":
      return `[${text(markdown.text)}](tel:${markdown.phone_number})`;
    case "anchor":
      return "";
    case "anchor_link":
    case "reference":
    case "reference_link":
      return text(markdown.text);
    default:
      return "";
  }
}

function caption(value?: TelegramRichCaption): string {
  if (!value) {
    return "";
  }
  const credit = value.credit ? `\n${text(value.credit)}` : "";
  return `${text(value.text)}${credit}`;
}

function cell(value: TelegramRichCell): string {
  return value.text ? text(value.text).replaceAll("|", "\\|") : "";
}

function item(value: TelegramRichItem): string {
  let checked = "";
  if (value.has_checkbox) {
    checked = value.is_checked ? "[x] " : "[ ] ";
  }
  const content = value.blocks.map(block).join("\n\n").replaceAll("\n", "\n  ");
  return `${value.label} ${checked}${content}`.trimEnd();
}

function table(value: Extract<TelegramRichBlock, { type: "table" }>): string {
  const rows = value.cells.map((row) => `| ${row.map(cell).join(" | ")} |`);
  if (rows.length === 0) {
    return value.caption ? text(value.caption) : "";
  }

  const columns = Math.max(...value.cells.map((row) => row.length));
  const separator = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
  const content = [rows[0], separator, ...rows.slice(1)].join("\n");
  return value.caption ? `${text(value.caption)}\n\n${content}` : content;
}

function quote(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function block(value: TelegramRichBlock): string {
  switch (value.type) {
    case "paragraph":
    case "footer":
    case "thinking":
      return text(value.text);
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, value.size)))} ${text(value.text)}`;
    case "pre":
      return `\`\`\`${value.language ?? ""}\n${text(value.text)}\n\`\`\``;
    case "divider":
      return "---";
    case "mathematical_expression":
      return `$$${value.expression}$$`;
    case "anchor":
      return "";
    case "list":
      return value.items.map(item).join("\n");
    case "blockquote": {
      const content = value.blocks.map(block).join("\n\n");
      const credit = value.credit ? `\n\n${text(value.credit)}` : "";
      return quote(`${content}${credit}`);
    }
    case "pullquote": {
      const credit = value.credit ? `\n\n${text(value.credit)}` : "";
      return quote(`${text(value.text)}${credit}`);
    }
    case "collage":
    case "slideshow": {
      const content = value.blocks.map(block).filter(Boolean).join("\n\n");
      const description = caption(value.caption);
      return [content, description].filter(Boolean).join("\n\n");
    }
    case "table":
      return table(value);
    case "details":
      return `${text(value.summary)}\n\n${value.blocks.map(block).join("\n\n")}`;
    case "map":
      return caption(value.caption);
    case "animation":
    case "audio":
    case "photo":
    case "video":
    case "voice_note":
      return caption(value.caption);
    default:
      return "";
  }
}

export function richMessageToMarkdown(message: TelegramRichMessage): string {
  return message.blocks.map(block).filter(Boolean).join("\n\n").trim();
}

export function richMessageToText(message: TelegramRichMessage): string {
  const markdown = richMessageToMarkdown(message);
  return markdownToPlainText(markdown).trim() || markdown;
}
