"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

interface ReadmeContentProps {
  children: string;
}

const stripImages = (markdown: string): string =>
  markdown
    // Remove markdown images: ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Remove HTML img tags: <img ... /> or <img ...>
    .replace(/<img[^>]*\/?>/gi, "")
    // Clean up empty lines left behind
    .replace(/^\s*\[?\s*\]?\s*$/gm, "");

export const ReadmeContent = ({ children }: ReadmeContentProps) => (
  <Streamdown
    linkSafety={{ enabled: false }}
    mode="static"
    plugins={{ cjk, code, math, mermaid }}
  >
    {stripImages(children)}
  </Streamdown>
);
