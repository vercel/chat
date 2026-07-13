/**
 * Bare `@mention` resolver shared across adapters.
 *
 * Converting a bare `@name` into a platform mention with a naive
 * `/@(\w+)/g` regex mangles surrounding text: it rewrites email addresses
 * (`user@example.com`), `@handles` inside URLs (`https://github.com/@org`),
 * and mentions inside code spans. `replaceBareMentions` scans the text
 * character-by-character and skips:
 *
 * - inline code and fenced code (`` `…` `` / ```` ``` ````)
 * - URLs with a scheme (`http://…`, `https://…`)
 * - schemeless hosts followed by a path (`example.com/…`)
 * - existing angle-bracket tokens (`<@123>`, `<at>…</at>`, `<url|label>`)
 *
 * Only an `@` at a word boundary that is followed by a word character is
 * handed to the `replacer`, which decides how to render it for the target
 * platform.
 */

export type MentionReplacer = (mention: string, name: string) => string;

const HTTP = "http://";
const HTTPS = "https://";

function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNumber(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isWord(char: string | undefined): boolean {
  return (
    char !== undefined && (isLetter(char) || isNumber(char) || char === "_")
  );
}

function isHost(char: string): boolean {
  return isLetter(char) || isNumber(char) || char === "." || char === "-";
}

function isBoundary(char: string): boolean {
  return char === "<" || char === ">" || char.trim() === "";
}

function startsWith(text: string, index: number, value: string): boolean {
  return text.slice(index, index + value.length).toLowerCase() === value;
}

function findUrlEnd(text: string, index: number, end: number): number {
  let prefix = 0;
  if (startsWith(text, index, HTTPS)) {
    prefix = HTTPS.length;
  } else if (startsWith(text, index, HTTP)) {
    prefix = HTTP.length;
  }

  if (prefix === 0 || index + prefix >= end) {
    return index;
  }

  let cursor = index + prefix;
  while (cursor < end && !isBoundary(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function findHostEnd(text: string, index: number, end: number): number {
  if (!(isLetter(text[index]) || isNumber(text[index]))) {
    return index;
  }
  if (index > 0 && isHost(text[index - 1])) {
    return index;
  }

  let cursor = index;
  while (cursor < end && isHost(text[cursor])) {
    cursor += 1;
  }

  const separator = text[cursor];
  if (separator !== "/" && separator !== "?" && separator !== "#") {
    return index;
  }

  const host = text.slice(index, cursor);
  const dot = host.lastIndexOf(".");
  const suffix = host.slice(dot + 1);
  if (dot <= 0 || suffix.length < 2) {
    return index;
  }
  for (const char of suffix) {
    if (!isLetter(char)) {
      return index;
    }
  }

  cursor += 1;
  while (cursor < end && !isBoundary(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function findCodeEnd(text: string, index: number, end: number): number {
  if (text[index] !== "`") {
    return index;
  }

  const fence = text.startsWith("```", index);
  const marker = fence ? "```" : "`";
  const start = index + marker.length;
  const close = text.indexOf(marker, start);

  if (close === -1 || close >= end) {
    return index;
  }
  if (!fence) {
    const newline = text.indexOf("\n", start);
    if (newline !== -1 && newline < close) {
      return index;
    }
  }
  return close + marker.length;
}

function replaceRange(
  text: string,
  start: number,
  end: number,
  replacer: MentionReplacer,
  angles: boolean
): string {
  let result = "";
  let index = start;

  while (index < end) {
    const codeEnd = findCodeEnd(text, index, end);
    if (codeEnd > index) {
      result += text.slice(index, codeEnd);
      index = codeEnd;
      continue;
    }

    if (angles && text[index] === "<") {
      let cursor = index + 1;
      while (
        cursor < end &&
        text[cursor] !== ">" &&
        text[cursor] !== "\n" &&
        text[cursor] !== "\r"
      ) {
        cursor += 1;
      }

      if (text[cursor] === ">") {
        result += text.slice(index, cursor + 1);
        index = cursor + 1;
        continue;
      }

      result += replaceRange(text, index, cursor, replacer, false);
      index = cursor;
      continue;
    }

    const urlEnd = findUrlEnd(text, index, end);
    if (urlEnd > index) {
      result += text.slice(index, urlEnd);
      index = urlEnd;
      continue;
    }

    const hostEnd = findHostEnd(text, index, end);
    if (hostEnd > index) {
      result += text.slice(index, hostEnd);
      index = hostEnd;
      continue;
    }

    if (
      text[index] === "@" &&
      text[index - 1] !== "<" &&
      !isWord(text[index - 1]) &&
      isWord(text[index + 1])
    ) {
      let cursor = index + 2;
      while (cursor < end && isWord(text[cursor])) {
        cursor += 1;
      }
      const mention = text.slice(index, cursor);
      result += replacer(mention, mention.slice(1));
      index = cursor;
      continue;
    }

    result += text[index];
    index += 1;
  }

  return result;
}

export function replaceBareMentions(
  text: string,
  replacer: MentionReplacer
): string {
  return replaceRange(text, 0, text.length, replacer, true);
}
