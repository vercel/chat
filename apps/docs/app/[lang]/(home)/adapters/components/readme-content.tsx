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
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
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
