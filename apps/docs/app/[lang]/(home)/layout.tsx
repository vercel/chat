import { HomeLayout } from "@/components/geistdocs/home-layout";
import { source } from "@/lib/geistdocs/source";

const Layout = async ({ children, params }: LayoutProps<"/[lang]">) => {
  const { lang } = await params;

  return (
    <HomeLayout tree={source.pageTree[lang]}>
      <div className="min-h-screen bg-background-200 pt-0 pb-16">
        {children}
      </div>
    </HomeLayout>
  );
};

export default Layout;
