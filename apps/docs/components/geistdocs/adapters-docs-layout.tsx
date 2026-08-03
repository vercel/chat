import { GeistdocsDocsLayout as PackageDocsLayout } from "@vercel/geistdocs/layout";
import type { ComponentProps, ReactNode } from "react";
import { config } from "@/lib/geistdocs/config";

interface AdaptersDocsLayoutProps {
  children: ReactNode;
  tree: ComponentProps<typeof PackageDocsLayout>["tree"];
}

export const AdaptersDocsLayout = ({
  tree,
  children,
}: AdaptersDocsLayoutProps) => (
  <PackageDocsLayout
    config={config}
    containerProps={{
      className: "bg-background-200 max-w-[1448px] mx-auto",
    }}
    tree={tree}
  >
    {children}
  </PackageDocsLayout>
);
