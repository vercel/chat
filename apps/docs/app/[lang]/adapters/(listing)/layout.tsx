import type { ReactNode } from "react";
import { HomeLayout } from "@/components/geistdocs/home-layout";
import { source } from "@/lib/geistdocs/source";

interface AdaptersListingLayoutProps {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}

const Layout = async ({ children, params }: AdaptersListingLayoutProps) => {
  const { lang } = await params;

  return (
    <HomeLayout tree={source.pageTree[lang]}>
      <div className="min-h-screen bg-background-200 pt-0 pb-32">
        {children}
      </div>
    </HomeLayout>
  );
};

export default Layout;
