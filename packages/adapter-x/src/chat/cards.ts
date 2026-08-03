/**
 * Card rendering for the XChat adapter.
 *
 * XChat has no interactive card primitives (no buttons, keyboards, or
 * callbacks), so cards degrade to what the wire protocol carries:
 *
 * - text with tappable rich-text entities (urls, mentions)
 * - one URL preview card per message (`attachment_type: "url"`), optionally
 *   with an encrypted banner image
 *
 * Link buttons and inline links become `label: url` lines so they stay
 * usable as entities. Callback buttons have no representation and are
 * omitted, matching the shared fallback-text behavior.
 */

import { cardToFallbackText } from "@chat-adapter/shared";
import type { CardChild, CardElement } from "chat";

/** A URL preview card derived from a CardElement. */
export interface XchatUrlCardSpec {
  /** Title shown on the preview card. */
  displayTitle?: string;
  /** Image to encrypt and attach as the card banner. */
  imageUrl?: string;
  url: string;
}

export interface XchatCardResult {
  text: string;
  /** The card's primary link, when it has one. */
  urlCard?: XchatUrlCardSpec;
}

interface CollectedLink {
  label?: string;
  url: string;
}

function collectLinks(children: CardChild[], out: CollectedLink[]): void {
  for (const child of children) {
    if (child.type === "link") {
      out.push({ label: child.label, url: child.url });
    } else if (child.type === "actions") {
      for (const action of child.children) {
        if (action.type === "link-button") {
          out.push({ label: action.label, url: action.url });
        }
      }
    } else if (child.type === "section") {
      collectLinks(child.children, out);
    }
  }
}

function firstImageUrl(card: CardElement): string | undefined {
  if (card.imageUrl) {
    return card.imageUrl;
  }
  const stack: CardChild[] = [...card.children];
  while (stack.length > 0) {
    const child = stack.shift();
    if (!child) {
      continue;
    }
    if (child.type === "image") {
      return child.url;
    }
    if (child.type === "section") {
      stack.push(...child.children);
    }
  }
  return undefined;
}

/**
 * Render a card to XChat message parts: plain text (links appended as
 * `label: url` lines so URL entities make them tappable) and the primary
 * link as a URL preview card spec.
 */
export function cardToXChat(card: CardElement): XchatCardResult {
  const links: CollectedLink[] = [];
  collectLinks(card.children, links);

  // XChat renders plain text, so unwrap the bold markers the shared
  // fallback puts around the title.
  let text = cardToFallbackText(card, {
    boldFormat: "*",
    lineBreak: "\n",
    // The gchat fallback profile produces the plain-text output XChat needs.
    platform: "gchat",
  });
  if (card.title) {
    text = text.replace(`*${card.title}*`, card.title);
  }

  // The first link is the card's primary destination; the rest surface as
  // extra lines (the shared fallback already renders inline `link` children,
  // so only action-row link buttons need appending).
  const buttonLinks: CollectedLink[] = [];
  const seenInText = new Set<string>();
  for (const child of card.children) {
    if (child.type === "link") {
      seenInText.add(child.url);
    }
    if (child.type === "section") {
      for (const inner of child.children) {
        if (inner.type === "link") {
          seenInText.add(inner.url);
        }
      }
    }
  }
  for (const link of links) {
    if (!seenInText.has(link.url)) {
      buttonLinks.push(link);
    }
  }

  const linkLines = buttonLinks.map((l) =>
    l.label ? `${l.label}: ${l.url}` : l.url
  );
  const fullText = [text, ...linkLines].filter(Boolean).join("\n");

  const primary = links[0];
  const urlCard: XchatUrlCardSpec | undefined = primary
    ? {
        url: primary.url,
        displayTitle: card.title ?? primary.label,
        imageUrl: firstImageUrl(card),
      }
    : undefined;

  return { text: fullText, urlCard };
}
