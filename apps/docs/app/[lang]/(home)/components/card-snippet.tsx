"use client";

import { CopyButton } from "./copy-button";

/**
 * Install snippet safe to render inside a linked card. The copy control sits
 * inside the card's anchor, so its click would otherwise follow the href;
 * cancelling in the capture phase keeps copying from navigating.
 *
 * Needs to be its own client component because a Server Component can't pass
 * the event handler down.
 */
export const CardSnippet = ({ text }: { text: string }) => (
  <div
    className="relative w-full rounded-md border bg-background py-[10px] pr-12 pl-3 font-mono text-copy-13 leading-5 [&_button]:absolute [&_button]:top-1/2 [&_button]:right-1 [&_button]:size-8 [&_button]:-translate-y-1/2 [&_button]:rounded-md [&_svg]:size-4"
    data-card-snippet
    onClickCapture={(event) => event.preventDefault()}
    onKeyDownCapture={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
      }
    }}
  >
    <span className="select-none text-muted-foreground">$ </span>
    {text}
    <CopyButton code={text} />
  </div>
);
