import { AdaptersDocsLayout } from "@/components/geistdocs/adapters-docs-layout";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { getRootLang } from "@/lib/geistdocs/root-params";

const Layout = async ({ children }: LayoutProps<"/[lang]/adapters">) => {
  const lang = await getRootLang();

  return (
    <div className="bg-background-200">
      <AdaptersDocsLayout tree={adaptersSource.pageTree[lang]}>
        {children}
      </AdaptersDocsLayout>
    </div>
  );
};

export default Layout;
