const GOOGLE_CHAT_LINK_PATTERN = /<([^>|]+)\|([^>]+)>/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

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
    .replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**")
    .replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");
}

export function markdownToGoogleChat(markdown: string): string {
  return markdown
    .replace(MARKDOWN_LINK_PATTERN, (_match, label: string, url: string) =>
      formatGoogleChatLink(url, label)
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "_$1_")
    .replace(/~~([^~\n]+)~~/g, "~$1~");
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
