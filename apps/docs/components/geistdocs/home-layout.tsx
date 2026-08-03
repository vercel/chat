import { GeistdocsHomeLayout } from "@vercel/geistdocs/home-layout";
import type { ComponentProps, ReactNode } from "react";
import { config } from "@/lib/geistdocs/config";

interface HomeLayoutProps {
  children: ReactNode;
  tree: ComponentProps<typeof GeistdocsHomeLayout>["tree"];
}

export const HomeLayout = ({ tree, children }: HomeLayoutProps) => (
  <GeistdocsHomeLayout config={config} tree={tree}>
    {children}
  </GeistdocsHomeLayout>
);
