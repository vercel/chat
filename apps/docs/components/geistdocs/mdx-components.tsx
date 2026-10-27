import { Table as GeistdocsTable } from "@vercel/geistdocs/components/table";
import {
  createMdxComponents,
  getGeistdocsMDXComponents,
} from "@vercel/geistdocs/mdx";
import type { MDXComponents } from "mdx/types";
import {
  Children,
  type ComponentProps,
  type ComponentType,
  isValidElement,
  type ReactNode,
} from "react";
import { Check, Cross, Warn } from "@/components/custom/status-icons";
import { AdapterSlugList } from "./adapter-slug-list";
import { CreateChatSdk } from "./create-chat-sdk";
import { FeatureSupport } from "./feature-support";
import { GlobalFeatureMatrix } from "./global-feature-matrix";
import { PackageInstall } from "./package-install";

// Geistdocs tables, including the one TypeTable renders, scroll inside a
// wrapper that keyboard users cannot focus. Move scrolling to a focusable
// region around it so wide tables can be scrolled with the arrow keys.
const ScrollRegion = ({ children }: { children: ReactNode }) => (
  <div
    aria-label="Table"
    className="overflow-x-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-700 [&>div]:overflow-visible"
    role="region"
    tabIndex={0}
  >
    {children}
  </div>
);

const Table = (props: ComponentProps<"table">) => (
  <ScrollRegion>
    <GeistdocsTable {...props} />
  </ScrollRegion>
);

// Geistdocs does not export TypeTable on its own, and its MDX component map is
// untyped, so take it from the map with the props MDX passes it.
type TypeTableProps = { type: Record<string, unknown> };
const GeistdocsTypeTable = getGeistdocsMDXComponents()
  .TypeTable as ComponentType<TypeTableProps>;

const TypeTable = (props: TypeTableProps) => (
  <ScrollRegion>
    <GeistdocsTypeTable {...props} />
  </ScrollRegion>
);

const NESTED_LIST_TAGS = new Set(["ol", "ul"]);

const isNestedList = (node: unknown) =>
  isValidElement(node) &&
  typeof node.type === "string" &&
  NESTED_LIST_TAGS.has(node.type);

// GFM task list items render a bare checkbox. Wrapping the item's own text in
// a label gives the checkbox an accessible name. A nested list stays outside
// the label so its text and checkboxes are not folded into this item's name.
const ListItem = ({ children, className, ...props }: ComponentProps<"li">) => {
  if (!className?.includes("task-list-item")) {
    return (
      <li className={className} {...props}>
        {children}
      </li>
    );
  }
  const nodes = Children.toArray(children);
  const nestedListIndex = nodes.findIndex(isNestedList);
  const labelEnd = nestedListIndex === -1 ? nodes.length : nestedListIndex;
  return (
    <li className={className} {...props}>
      <label>{nodes.slice(0, labelEnd)}</label>
      {nodes.slice(labelEnd)}
    </li>
  );
};

export const getMDXComponents = (
  components?: MDXComponents
): MDXComponents =>
  createMdxComponents({
    li: ListItem,
    table: Table,
    Table,
    TypeTable,

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
