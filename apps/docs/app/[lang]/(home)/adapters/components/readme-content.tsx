"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

interface ReadmeContentProps {
  children: string;
}

// Streamdown's `linkSafety` defaults to `true`, which replaces <a> with <button>
// and breaks cmd-click/middle-click/"copy link" — explicit `false` is required.
export const ReadmeContent = ({ children }: ReadmeContentProps) => (
  <Streamdown
    disallowedElements={["img", "picture", "source"]}
    linkSafety={{ enabled: false }}
    mode="static"
    plugins={{ cjk, code }}
  >
    {children}
  </Streamdown>
);
