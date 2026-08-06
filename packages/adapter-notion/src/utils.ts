import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { NotionPageResponse, NotionThreadId } from "./types";

const COMPACT_UUID_PATTERN = /^[0-9a-f]{32}$/;
/** Paragraph boundary: one or more blank lines. */
const PARAGRAPH_BREAK = /\n{2,}/;

/**
 * Normalize a Notion UUID to lowercase hyphenated form.
 * Throws ValidationError if the value is not a UUID.
 */
export function normalizeUuid(value: string, field = "id"): string {
  const compact = value.replace(/-/g, "").toLowerCase();
  if (!COMPACT_UUID_PATTERN.test(compact)) {
    throw new ValidationError(
      "notion",
      `Invalid Notion UUID for ${field}: ${value}`
    );
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/**
 * Encode platform thread data into:
 * - `notion:{pageId}` — page channel root
 * - `notion:{pageId}:{discussionId}` — discussion reply (preferred over blockId)
 * - `notion:{pageId}:block:{blockId}` — outbound whole-block discussion start
 */
export function encodeThreadId(data: NotionThreadId): string {
  const pageId = normalizeUuid(data.pageId, "pageId");
  // Prefer discussionId when both are present (reply path).
  if (data.discussionId) {
    const discussionId = normalizeUuid(data.discussionId, "discussionId");
    return `notion:${pageId}:${discussionId}`;
  }
  if (data.blockId) {
    const blockId = normalizeUuid(data.blockId, "blockId");
    return `notion:${pageId}:block:${blockId}`;
  }
  return `notion:${pageId}`;
}

/**
 * Decode a Notion thread ID string.
 * Supports page, discussion, and whole-block (`…:block:{blockId}`) forms.
 */
export function decodeThreadId(threadId: string): NotionThreadId {
  const parts = threadId.split(":");
  if (parts[0] !== "notion" || parts.length < 2 || parts.length > 4) {
    throw new ValidationError(
      "notion",
      `Invalid Notion thread ID: ${threadId}`
    );
  }
  const pageId = normalizeUuid(parts[1] ?? "", "pageId");
  if (parts.length === 2) {
    return { pageId };
  }
  if (parts.length === 4 && parts[2] === "block") {
    return {
      pageId,
      blockId: normalizeUuid(parts[3] ?? "", "blockId"),
    };
  }
  if (parts.length === 3) {
    return {
      pageId,
      discussionId: normalizeUuid(parts[2] ?? "", "discussionId"),
    };
  }
  throw new ValidationError("notion", `Invalid Notion thread ID: ${threadId}`);
}

/** Channel ID is the page surface: `notion:{pageId}`. */
export function channelIdFromThreadId(threadId: string): string {
  const { pageId } = decodeThreadId(threadId);
  return encodeThreadId({ pageId });
}

/**
 * Verify Notion webhook signature.
 * Header format: `X-Notion-Signature: sha256=<hex>` over the raw body.
 */
export function verifyNotionSignature(
  rawBody: string,
  signature: string | null,
  verificationToken: string
): boolean {
  if (!signature?.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", verificationToken)
    .update(rawBody)
    .digest("hex")}`;
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Sign a raw body for tests / `/testing` builders. */
export function signNotionBody(
  rawBody: string,
  verificationToken: string
): string {
  return `sha256=${createHmac("sha256", verificationToken)
    .update(rawBody)
    .digest("hex")}`;
}

/**
 * Deep-link URL for a page discussion.
 * `blockId` is ignored — Notion page URLs are page-scoped only.
 */
export function getPageUrl(threadId: string, workspaceSlug?: string): string {
  const { pageId, discussionId } = decodeThreadId(threadId);
  const compact = pageId.replace(/-/g, "");
  const base = workspaceSlug
    ? `https://www.notion.so/${workspaceSlug}/${compact}`
    : `https://www.notion.so/${compact}`;
  if (discussionId) {
    return `${base}?d=${discussionId}`;
  }
  return base;
}

/**
 * Extract a plain-text title from a Notion page object's properties.
 * Finds the first property with `type: "title"` (or a `title` array).
 */
export function extractNotionPageTitle(
  page: NotionPageResponse
): string | undefined {
  const properties = page.properties;
  if (!properties) {
    return undefined;
  }

  for (const value of Object.values(properties)) {
    if (!value) {
      continue;
    }
    if (value.type === "title" || Array.isArray(value.title)) {
      const text = (value.title ?? [])
        .map((span) => span.plain_text ?? "")
        .join("")
        .trim();
      if (text.length > 0) {
        return text;
      }
    }
  }

  return undefined;
}

/**
 * Extract a plain-text description from the first non-title rich_text-like
 * page property (rich_text, text, or description-shaped arrays).
 */
export function extractNotionPageDescription(
  page: NotionPageResponse
): string | undefined {
  const properties = page.properties;
  if (!properties) {
    return undefined;
  }

  for (const value of Object.values(properties)) {
    if (!value) {
      continue;
    }
    if (value.type === "title" || Array.isArray(value.title)) {
      continue;
    }
    const spans = value.rich_text;
    if (!Array.isArray(spans) || spans.length === 0) {
      continue;
    }
    const text = spans
      .map((span) => span.plain_text ?? "")
      .join("")
      .trim();
    if (text.length > 0) {
      return text;
    }
  }

  return undefined;
}

/**
 * Split rendered comment markdown into chunks that each stay under Notion's
 * per-comment size ceiling. Notion caps a single rich-text run at 2000 chars
 * (a 400 `validation_error` past it); posting via the `markdown` body param,
 * the only realistic trigger is a long unbroken paragraph. Splits on
 * paragraph, then line, then character boundaries as a last resort.
 *
 * Returns `[]` for empty input — callers decide whether to post an empty body.
 */
export function chunkMarkdown(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return text.length > 0 ? [text] : [];
  }

  const chunks: string[] = [];
  let current = "";

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      chunks.push(trimmed);
    }
    current = "";
  };

  for (const paragraph of text.split(PARAGRAPH_BREAK)) {
    if (paragraph.length > maxChars) {
      flush();
      for (const piece of splitOversizedParagraph(paragraph, maxChars)) {
        chunks.push(piece);
      }
      continue;
    }
    const candidate =
      current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

/** Split an oversized paragraph on line, then hard character, boundaries. */
function splitOversizedParagraph(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let buffer = "";

  const flush = (): void => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
    buffer = "";
  };

  for (const line of text.split("\n")) {
    if (line.length > maxChars) {
      flush();
      for (let i = 0; i < line.length; i += maxChars) {
        out.push(line.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = buffer.length > 0 ? `${buffer}\n${line}` : line;
    if (candidate.length > maxChars) {
      flush();
      buffer = line;
    } else {
      buffer = candidate;
    }
  }
  flush();
  return out;
}
