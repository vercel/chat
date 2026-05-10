import type { ReactNode } from "react";
import { AdaptersDocsLayout } from "@/components/geistdocs/adapters-docs-layout";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";

interface AdapterDetailLayoutProps {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}

const Layout = async ({ children, params }: AdapterDetailLayoutProps) => {
  const { lang } = await params;

  return (
    <div className="bg-background-200">
      <AdaptersDocsLayout tree={adaptersSource.pageTree[lang]}>
        {children}
      </AdaptersDocsLayout>
    </div>
  );
};

export default Layout;
