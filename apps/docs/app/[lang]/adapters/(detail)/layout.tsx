import type { ReactNode } from "react";
import { DocsLayout } from "@/components/geistdocs/docs-layout";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";

interface AdapterDetailLayoutProps {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}

const Layout = async ({ children, params }: AdapterDetailLayoutProps) => {
  const { lang } = await params;

  return (
    <div className="bg-background-200">
      <DocsLayout tree={adaptersSource.pageTree[lang]}>{children}</DocsLayout>
    </div>
  );
};

export default Layout;
