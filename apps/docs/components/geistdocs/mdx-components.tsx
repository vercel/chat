import { Table as GeistdocsTable } from "@vercel/geistdocs/components/table";
import { createMdxComponents } from "@vercel/geistdocs/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { Check, Cross, Warn } from "@/components/custom/status-icons";
import { AdapterSlugList } from "./adapter-slug-list";
import { CreateChatSdk } from "./create-chat-sdk";
import { FeatureSupport } from "./feature-support";
import { GlobalFeatureMatrix } from "./global-feature-matrix";
import { PackageInstall } from "./package-install";

// The Geistdocs table scrolls inside a wrapper that keyboard users cannot
// focus. Move scrolling to a focusable region around it so wide tables can be
// scrolled with the arrow keys.
const Table = (props: ComponentProps<"table">) => (
  <div
    aria-label="Table"
    className="overflow-x-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-700 [&>div]:overflow-visible"
    role="region"
    tabIndex={0}
  >
    <GeistdocsTable {...props} />
  </div>
);

// GFM task list items render a bare checkbox. Wrapping the item in a label
// gives the checkbox its text as an accessible name.
const ListItem = ({ children, className, ...props }: ComponentProps<"li">) => (
  <li className={className} {...props}>
    {className?.includes("task-list-item") ? (
      <label>{children}</label>
    ) : (
      children
    )}
  </li>
);

export const getMDXComponents = (
  components?: MDXComponents
): MDXComponents =>
  createMdxComponents({
    li: ListItem,
    table: Table,
    Table,

    Check,
    Cross,
    Warn,

    FeatureSupport,
    GlobalFeatureMatrix,
    AdapterSlugList,
    CreateChatSdk,
    PackageInstall,

    // User components last to allow overwriting defaults
    ...components,
  });
