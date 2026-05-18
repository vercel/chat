import { DocsLayout as FumadocsDocsLayout } from "fumadocs-ui/layouts/docs";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import {
  AdaptersFolder,
  AdaptersItem,
  AdaptersSeparator,
  AdaptersSidebar,
} from "@/components/geistdocs/adapters-sidebar";
import { i18n } from "@/lib/geistdocs/i18n";

interface AdaptersDocsLayoutProps {
  children: ReactNode;
  tree: ComponentProps<typeof FumadocsDocsLayout>["tree"];
}

export const AdaptersDocsLayout = ({
  tree,
  children,
}: AdaptersDocsLayoutProps) => (
  <FumadocsDocsLayout
    containerProps={{
      className: "bg-background-200 max-w-[1448px] mx-auto",
      style: {
        "--fd-docs-row-1": "4rem",
      } as CSSProperties,
    }}
    i18n={i18n}
    nav={{
      enabled: false,
    }}
    searchToggle={{
      enabled: false,
    }}
    sidebar={{
      collapsible: false,
      component: <AdaptersSidebar />,
      components: {
        Folder: AdaptersFolder,
        Item: AdaptersItem,
        Separator: AdaptersSeparator,
      },
    }}
    tabMode="auto"
    themeSwitch={{
      enabled: false,
    }}
    tree={tree}
  >
    {children}
  </FumadocsDocsLayout>
);
