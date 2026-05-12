"use client";

import type { Node } from "fumadocs-core/page-tree";
import {
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  SidebarItem,
  SidebarSeparator,
} from "fumadocs-ui/components/sidebar/base";
import type { SidebarPageTreeComponents } from "fumadocs-ui/components/sidebar/page-tree";
import { useTreeContext, useTreePath } from "fumadocs-ui/contexts/tree";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSidebarContext } from "@/hooks/geistdocs/use-sidebar";
import { cn } from "@/lib/utils";
import { SearchButton } from "./search";

const SUB_SEPARATOR_NAMES = new Set(["Platforms", "State"]);
const TOP_DIVIDER_FOLDER_NAMES = new Set([
  "Vendor-Official Adapters",
  "Community Adapters",
]);

export const AdaptersSidebar = () => {
  const { root } = useTreeContext();
  const { isOpen, setIsOpen } = useSidebarContext();
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (pathname !== previousPathname.current) {
      setIsOpen(false);
      previousPathname.current = pathname;
    }
  }, [pathname, setIsOpen]);

  const renderSidebarList = (items: Node[]) =>
    items.map((item) => {
      if (item.type === "separator") {
        return <AdaptersSeparator item={item} key={item.$id} />;
      }

      if (item.type === "folder") {
        const children = renderSidebarList(item.children);
        return (
          <AdaptersFolder item={item} key={item.$id}>
            {children}
          </AdaptersFolder>
        );
      }

      return <AdaptersItem item={item} key={item.$id} />;
    });

  return (
    <div
      className="pointer-events-none sticky top-(--fd-docs-row-1) z-20 h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] [grid-area:sidebar] *:pointer-events-auto max-md:hidden md:layout:[--fd-sidebar-width:268px]"
      data-sidebar-placeholder
    >
      <div className="styled-scrollbar h-full overflow-y-auto px-4 pt-12 pb-4">
        <Fragment key={root.$id}>{renderSidebarList(root.children)}</Fragment>
      </div>
      <Sheet onOpenChange={setIsOpen} open={isOpen}>
        <SheetContent className="gap-0" side="left">
          <SheetHeader className="mt-8">
            <SheetTitle className="sr-only">Mobile Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Navigation for the documentation.
            </SheetDescription>
            <SearchButton onClick={() => setIsOpen(false)} />
          </SheetHeader>
          <div className="styled-scrollbar flex-1 overflow-y-auto px-4 pb-4">
            {renderSidebarList(root.children)}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const AdaptersFolder: SidebarPageTreeComponents["Folder"] = ({
  children,
  item,
}) => {
  const path = useTreePath();
  const defaultOpen = item.defaultOpen ?? path.includes(item);
  const hasTopDivider =
    typeof item.name === "string" && TOP_DIVIDER_FOLDER_NAMES.has(item.name);

  return (
    <SidebarFolder
      className={cn(hasTopDivider && "mt-4 border-t pt-4")}
      defaultOpen={defaultOpen}
    >
      {item.index ? (
        <SidebarFolderLink
          className="flex items-center gap-2 text-pretty py-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground data-[active=true]:text-foreground [&_svg]:size-3.5"
          external={item.index.external}
          href={item.index.url}
        >
          {item.icon}
          {item.name}
        </SidebarFolderLink>
      ) : (
        <SidebarFolderTrigger className="flex items-center gap-2 text-pretty py-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5">
          {item.icon}
          {item.name}
        </SidebarFolderTrigger>
      )}
      <SidebarFolderContent className="ml-2">{children}</SidebarFolderContent>
    </SidebarFolder>
  );
};

export const AdaptersItem: SidebarPageTreeComponents["Item"] = ({ item }) => (
  <SidebarItem
    className="block w-full truncate text-pretty py-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground data-[active=true]:text-foreground"
    external={item.external}
    href={item.url}
    icon={item.icon}
  >
    {item.name}
  </SidebarItem>
);

export const AdaptersSeparator: SidebarPageTreeComponents["Separator"] = ({
  item,
}) => {
  const isSub =
    typeof item.name === "string" && SUB_SEPARATOR_NAMES.has(item.name);

  return (
    <SidebarSeparator
      className={cn(
        "mt-4 mb-1.5 flex items-center gap-2 px-0 font-medium text-[12px] uppercase tracking-[0.08em] text-muted-foreground/70 first-child:mt-0",
        isSub &&
          "mt-3 mb-1 text-muted-foreground/60 text-[12px] uppercase tracking-[0.08em]"
      )}
    >
      {item.icon}
      {item.name}
    </SidebarSeparator>
  );
};
