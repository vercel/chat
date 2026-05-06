"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { ComponentProps } from "react";
import { defaultRemarkPlugins, Streamdown } from "streamdown";
import { Callout } from "@/components/geistdocs/callout";

const GFM_ALERT_PATTERN =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\r?\n?/;

const ALERT_TYPES = {
  note: "info",
  tip: "success",
  important: "info",
  warning: "warn",
  caution: "error",
} as const;

type AlertType = keyof typeof ALERT_TYPES;

interface MdNode {
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
  type: string;
  value?: string;
}

function resolveExistingClasses(existing: unknown): string[] {
  if (Array.isArray(existing)) {
    return existing as string[];
  }
  if (typeof existing === "string") {
    return [existing];
  }
  return [];
}

const tagAlertBlockquote = (bq: MdNode) => {
  const para = bq.children?.[0];
  if (para?.type !== "paragraph") {
    return;
  }
  const first = para.children?.[0];
  if (first?.type !== "text" || typeof first.value !== "string") {
    return;
  }
  const match = GFM_ALERT_PATTERN.exec(first.value);
  if (!match) {
    return;
  }
  first.value = first.value.slice(match[0].length);
  if (first.value === "") {
    para.children?.shift();
  }
  const prior = resolveExistingClasses(bq.data?.hProperties?.className);
  bq.data = {
    ...bq.data,
    hProperties: {
      ...bq.data?.hProperties,
      className: [...prior, "gfm-alert", `gfm-alert-${match[1].toLowerCase()}`],
    },
  };
};

const walkAlerts = (node: MdNode) => {
  if (node.type === "blockquote") {
    tagAlertBlockquote(node);
  }
  if (node.children) {
    for (const child of node.children) {
      walkAlerts(child);
    }
  }
};

const remarkGfmAlert = () => (tree: MdNode) => walkAlerts(tree);

const isAlertType = (value: unknown): value is AlertType =>
  typeof value === "string" && value in ALERT_TYPES;

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const ALERT_CLASS_PATTERN = /(?:^|\s)gfm-alert-([a-z]+)(?:\s|$)/;

const Blockquote = ({
  children,
  className,
  node: _node,
  ...rest
}: ComponentProps<"blockquote"> & { node?: unknown }) => {
  const match =
    typeof className === "string" ? ALERT_CLASS_PATTERN.exec(className) : null;
  const type = match?.[1];
  if (isAlertType(type)) {
    return (
      <Callout title={titleCase(type)} type={ALERT_TYPES[type]}>
        {children}
      </Callout>
    );
  }
  return (
    <blockquote className={className} {...rest}>
      {children}
    </blockquote>
  );
};

interface ReadmeContentProps {
  children: string;
}

// Streamdown's `linkSafety` defaults to `true`, which replaces <a> with <button>
// and breaks cmd-click/middle-click/"copy link" — explicit `false` is required.
export const ReadmeContent = ({ children }: ReadmeContentProps) => (
  <Streamdown
    allowedTags={{ blockquote: ["className"] }}
    components={{ blockquote: Blockquote }}
    disallowedElements={["img", "picture", "source"]}
    linkSafety={{ enabled: false }}
    mode="static"
    plugins={{ cjk, code }}
    remarkPlugins={[...Object.values(defaultRemarkPlugins), remarkGfmAlert]}
  >
    {children}
  </Streamdown>
);
