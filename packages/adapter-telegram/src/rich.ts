import type { Attachment } from "chat";
import { StreamingMarkdownRenderer } from "chat";
import type {
  TelegramFile,
  TelegramRichBlock,
  TelegramRichCaption,
  TelegramRichCell,
  TelegramRichItem,
  TelegramRichMessage,
  TelegramRichText,
} from "./types";

export const TELEGRAM_RICH_MESSAGE_LIMIT = 32_768;
const MARKDOWN_PUNCTUATION = /[!-/:-@[-`{-~]/g;
const LINE_BREAKS = /[\r\n]/g;
const BACKTICKS = /`+/g;

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

function escapeText(value: string): string {
  return value.replace(MARKDOWN_PUNCTUATION, "\\$&");
}

function inlineCode(value: string): string {
  if (!value) {
    return "";
  }
  const runs = value.match(BACKTICKS) ?? [];
  const size = Math.max(1, ...runs.map((run) => run.length + 1));
  const marker = "`".repeat(size);
  const hasBoundarySpace =
    value.startsWith(" ") && value.endsWith(" ") && value.trim().length > 0;
  const padding =
    value.startsWith("`") || value.endsWith("`") || hasBoundarySpace ? " " : "";
  return `${marker}${padding}${value}${padding}${marker}`;
}

function codeBlock(value: string, language?: string): string {
  const runs = value.match(BACKTICKS) ?? [];
  const size = Math.max(3, ...runs.map((run) => run.length + 1));
  const marker = "`".repeat(size);
  const info = language?.replace(LINE_BREAKS, " ").replaceAll("`", "") ?? "";
  return `${marker}${info}\n${value}\n${marker}`;
}

function linkDestination(value: string): string {
  return `<${value
    .replaceAll("\\", "%5C")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")}>`;
}

function text(markdown: TelegramRichText): string {
  if (typeof markdown === "string") {
    return escapeText(markdown);
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
      return inlineCode(plain(markdown.text));
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
      return `[${text(markdown.text)}](${linkDestination(markdown.url)})`;
    case "email_address":
      return `[${text(markdown.text)}](${linkDestination(
        `mailto:${markdown.email_address}`
      )})`;
    case "phone_number":
      return `[${text(markdown.text)}](${linkDestination(
        `tel:${markdown.phone_number}`
      )})`;
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

function plain(markdown: TelegramRichText): string {
  if (typeof markdown === "string") {
    return markdown;
  }
  if (Array.isArray(markdown)) {
    return markdown.map(plain).join("");
  }

  switch (markdown.type) {
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "spoiler":
    case "subscript":
    case "superscript":
    case "marked":
    case "code":
    case "date_time":
    case "text_mention":
    case "url":
    case "email_address":
    case "phone_number":
    case "bank_card_number":
    case "mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
    case "anchor_link":
    case "reference":
    case "reference_link":
      return plain(markdown.text);
    case "custom_emoji":
      return markdown.alternative_text;
    case "mathematical_expression":
      return markdown.expression;
    case "anchor":
      return "";
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

function plainCaption(value?: TelegramRichCaption): string {
  if (!value) {
    return "";
  }
  const credit = value.credit ? `\n${plain(value.credit)}` : "";
  return `${plain(value.text)}${credit}`;
}

function cell(value: TelegramRichCell): string {
  return value.text ? text(value.text) : "";
}

function item(value: TelegramRichItem): string {
  let checked = "";
  if (value.has_checkbox) {
    checked = value.is_checked ? "[x] " : "[ ] ";
  }
  const content = value.blocks.map(block).join("\n\n").replaceAll("\n", "\n  ");
  return `${value.label} ${checked}${content}`.trimEnd();
}

function plainItem(value: TelegramRichItem): string {
  let checked = "";
  if (value.has_checkbox) {
    checked = value.is_checked ? "[x] " : "[ ] ";
  }
  const content = value.blocks
    .map(plainBlock)
    .filter(Boolean)
    .join("\n")
    .replaceAll("\n", "\n  ");
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
      return codeBlock(plain(value.text), value.language);
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

function plainBlock(value: TelegramRichBlock): string {
  switch (value.type) {
    case "paragraph":
    case "footer":
    case "thinking":
    case "heading":
    case "pre":
      return plain(value.text);
    case "divider":
    case "anchor":
      return "";
    case "mathematical_expression":
      return value.expression;
    case "list":
      return value.items.map(plainItem).join("\n");
    case "blockquote": {
      const content = value.blocks.map(plainBlock).filter(Boolean).join("\n\n");
      const credit = value.credit ? `\n\n${plain(value.credit)}` : "";
      return `${content}${credit}`;
    }
    case "pullquote": {
      const credit = value.credit ? `\n\n${plain(value.credit)}` : "";
      return `${plain(value.text)}${credit}`;
    }
    case "collage":
    case "slideshow": {
      const content = value.blocks.map(plainBlock).filter(Boolean).join("\n\n");
      const description = plainCaption(value.caption);
      return [content, description].filter(Boolean).join("\n\n");
    }
    case "table": {
      const rows = value.cells.map((row) =>
        row.map((entry) => (entry.text ? plain(entry.text) : "")).join("\t")
      );
      const content = rows.join("\n");
      return value.caption ? `${plain(value.caption)}\n\n${content}` : content;
    }
    case "details":
      return `${plain(value.summary)}\n\n${value.blocks
        .map(plainBlock)
        .filter(Boolean)
        .join("\n\n")}`;
    case "map":
      return plainCaption(value.caption);
    case "animation":
    case "audio":
    case "photo":
    case "video":
    case "voice_note":
      return plainCaption(value.caption);
    default:
      return "";
  }
}

interface RichMedia {
  file: TelegramFile;
  height?: number;
  mimeType?: string;
  name?: string;
  type: Attachment["type"];
  width?: number;
}

function media(blocks: TelegramRichBlock[], result: RichMedia[]): void {
  for (const value of blocks) {
    switch (value.type) {
      case "list":
        for (const entry of value.items) {
          media(entry.blocks, result);
        }
        break;
      case "blockquote":
      case "collage":
      case "slideshow":
      case "details":
        media(value.blocks, result);
        break;
      case "animation":
        result.push({
          file: value.animation,
          height: value.animation.height,
          mimeType: value.animation.mime_type,
          name: value.animation.file_name,
          type: value.animation.mime_type?.startsWith("image/")
            ? "image"
            : "video",
          width: value.animation.width,
        });
        break;
      case "audio":
        result.push({
          file: value.audio,
          mimeType: value.audio.mime_type,
          name: value.audio.file_name,
          type: "audio",
        });
        break;
      case "photo": {
        const photo = value.photo.at(-1);
        if (photo) {
          result.push({
            file: photo,
            height: photo.height,
            type: "image",
            width: photo.width,
          });
        }
        break;
      }
      case "video":
        result.push({
          file: value.video,
          height: value.video.height,
          mimeType: value.video.mime_type,
          name: value.video.file_name,
          type: "video",
          width: value.video.width,
        });
        break;
      case "voice_note":
        result.push({
          file: value.voice_note,
          mimeType: value.voice_note.mime_type,
          type: "audio",
        });
        break;
      default:
        break;
    }
  }
}

export function richMessageToMarkdown(message: TelegramRichMessage): string {
  return message.blocks.map(block).filter(Boolean).join("\n\n").trim();
}

export function richMessageToText(message: TelegramRichMessage): string {
  return message.blocks.map(plainBlock).filter(Boolean).join("\n\n").trim();
}

export function richMessageMedia(message: TelegramRichMessage): RichMedia[] {
  const result: RichMedia[] = [];
  media(message.blocks, result);
  return result;
}
