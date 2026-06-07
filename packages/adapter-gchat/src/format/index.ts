const GOOGLE_CHAT_LINK_PATTERN = /<([^>|]+)\|([^>]+)>/g;
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const BOLD_MARKDOWN_PATTERN = /\*\*([^*\n]+)\*\*/g;
const BOLD_UNDERSCORE_MARKDOWN_PATTERN = /__([^_\n]+)__/g;
const ESCAPED_CHARACTER_PATTERN = /\\([()\\])/g;
const GOOGLE_CHAT_BOLD_PATTERN = /(?<![_*\\])\*([^*\n]+)\*(?![_*])/g;
const GOOGLE_CHAT_STRIKE_PATTERN = /(?<!~)~([^~\n]+)~(?!~)/g;
const MARKDOWN_STRIKE_PATTERN = /~~([^~\n]+)~~/g;

export function escapeGoogleChatText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatGoogleChatLink(url: string, label?: string): string {
  const safeUrl = safeGoogleChatLinkUrl(url);
  if (!safeUrl) {
    return escapeGoogleChatText(label ?? url);
  }

  const escapedUrl = escapeGoogleChatText(safeUrl);
  const escapedLabel = label ? escapeGoogleChatText(label) : undefined;
  return escapedLabel && escapedLabel !== escapedUrl
    ? `<${escapedUrl}|${escapedLabel}>`
    : escapedUrl;
}

export function formatGoogleChatMention(userName: string): string {
  return `<${userName}>`;
}

export function googleChatToMarkdown(text: string): string {
  return text
    .replace(GOOGLE_CHAT_LINK_PATTERN, "[$2]($1)")
    .replace(GOOGLE_CHAT_BOLD_PATTERN, "**$1**")
    .replace(GOOGLE_CHAT_STRIKE_PATTERN, "~~$1~~");
}

export function markdownToGoogleChat(markdown: string): string {
  return replaceMarkdownLinks(markdown)
    .replace(BOLD_MARKDOWN_PATTERN, "*$1*")
    .replace(BOLD_UNDERSCORE_MARKDOWN_PATTERN, "*$1*")
    .replace(MARKDOWN_STRIKE_PATTERN, "~$1~");
}

export function convertGoogleChatEmojiPlaceholders(text: string): string {
  return text
    .replace(/:thumbsup:/g, "👍")
    .replace(/:thumbs_up:/g, "👍")
    .replace(/:white_check_mark:/g, "✅")
    .replace(/:x:/g, "❌")
    .replace(/:warning:/g, "⚠️");
}

function safeGoogleChatLinkUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

function replaceMarkdownLinks(markdown: string): string {
  let result = "";
  let index = 0;

  while (index < markdown.length) {
    const labelStart = markdown.indexOf("[", index);
    if (labelStart === -1) {
      result += markdown.slice(index);
      break;
    }

    result += markdown.slice(index, labelStart);
    const labelEnd = findMarkdownLabelEnd(markdown, labelStart + 1);
    if (labelEnd === -1 || markdown[labelEnd + 1] !== "(") {
      result += markdown[labelStart];
      index = labelStart + 1;
      continue;
    }

    const urlStart = labelEnd + 2;
    const urlEnd = findMarkdownUrlEnd(markdown, urlStart);
    if (urlEnd === -1) {
      result += markdown.slice(labelStart, urlStart);
      index = urlStart;
      continue;
    }

    const label = markdown.slice(labelStart + 1, labelEnd);
    const url = unescapeMarkdownUrl(markdown.slice(urlStart, urlEnd));
    result += formatGoogleChatLink(url, label);
    index = urlEnd + 1;
  }

  return result;
}

function findMarkdownLabelEnd(markdown: string, start: number): number {
  for (let index = start; index < markdown.length; index++) {
    if (markdown[index] === "\\" && index + 1 < markdown.length) {
      index++;
      continue;
    }
    if (markdown[index] === "]") {
      return index;
    }
  }

  return -1;
}

function findMarkdownUrlEnd(markdown: string, start: number): number {
  let depth = 0;
  for (let index = start; index < markdown.length; index++) {
    const character = markdown[index];
    if (character === "\\" && index + 1 < markdown.length) {
      index++;
      continue;
    }
    if (character === "(") {
      depth++;
      continue;
    }
    if (character === ")") {
      if (depth === 0) {
        return index;
      }
      depth--;
    }
  }

  return -1;
}

function unescapeMarkdownUrl(url: string): string {
  return url.replace(ESCAPED_CHARACTER_PATTERN, "$1");
}
