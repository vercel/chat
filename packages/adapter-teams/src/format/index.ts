const HTML_ESCAPE_PATTERN = /[&<>"]/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const TEAMS_MENTION_PATTERN = /<at\b[^>]*>(.*?)<\/at>/gis;

const HTML_ESCAPES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

const EMOJI_PLACEHOLDERS: Record<string, string> = {
  ":red_circle:": "🔴",
  ":warning:": "⚠️",
  ":white_check_mark:": "✅",
  ":x:": "❌",
};
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function escapeTeamsText(text: string): string {
  return text.replace(
    HTML_ESCAPE_PATTERN,
    (char) => HTML_ESCAPES[char] ?? char
  );
}

export function unescapeTeamsText(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function formatTeamsMention(name: string): string {
  return `<at>${escapeTeamsText(name)}</at>`;
}

export function teamsMentionToPlainText(text: string): string {
  return text.replace(TEAMS_MENTION_PATTERN, (_match, name: string) => {
    return `@${unescapeTeamsText(stripTags(name).trim())}`;
  });
}

export function teamsHtmlToMarkdown(html: string): string {
  return unescapeTeamsText(
    teamsMentionToPlainText(html)
      .replace(/<strong\b[^>]*>(.*?)<\/strong>/gis, "**$1**")
      .replace(/<b\b[^>]*>(.*?)<\/b>/gis, "**$1**")
      .replace(/<em\b[^>]*>(.*?)<\/em>/gis, "_$1_")
      .replace(/<i\b[^>]*>(.*?)<\/i>/gis, "_$1_")
      .replace(/<s\b[^>]*>(.*?)<\/s>/gis, "~~$1~~")
      .replace(/<strike\b[^>]*>(.*?)<\/strike>/gis, "~~$1~~")
      .replace(/<code\b[^>]*>(.*?)<\/code>/gis, "`$1`")
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, "[$2]($1)")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\u00a0/g, " ")
  ).trim();
}

export function markdownToTeamsHtml(markdown: string): string {
  return convertTeamsEmojiPlaceholders(escapeTeamsText(markdown))
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.*?)_/g, "<em>$1</em>")
    .replace(/~~(.*?)~~/g, "<s>$1</s>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(MARKDOWN_LINK_PATTERN, (_match, label: string, href: string) =>
      safeLinkHref(href) ? `<a href="${href}">${label}</a>` : label
    )
    .replace(/\n/g, "<br>");
}

export function convertTeamsEmojiPlaceholders(text: string): string {
  let converted = text;
  for (const [placeholder, emoji] of Object.entries(EMOJI_PLACEHOLDERS)) {
    converted = converted.replaceAll(placeholder, emoji);
  }
  return converted;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function safeLinkHref(href: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}
