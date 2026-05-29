import "../global.css";
import type { Metadata } from "next";
import { Footer } from "@/components/geistdocs/footer";
import { Navbar } from "@/components/geistdocs/navbar";
import { GeistdocsProvider } from "@/components/geistdocs/provider";
import { basePath } from "@/geistdocs";
import { mono, sans } from "@/lib/geistdocs/fonts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: {
    template: "%s | Chat SDK",
    default: "Chat SDK",
  },
  openGraph: {
    title: {
      template: "%s | Chat SDK",
      default: "Chat SDK",
    },
  },
};

const Layout = async ({ children, params }: LayoutProps<"/[lang]">) => {
  const { lang } = await params;

  return (
    <html
      className={cn(sans.variable, mono.variable, "antialiased")}
      lang={lang}
      suppressHydrationWarning
    >
      <head>
        <link href="/llms.txt" rel="llms-txt" />
      </head>
      <body>
        <GeistdocsProvider basePath={basePath} lang={lang}>
          <Navbar />
          {children}
          <Footer />
        </GeistdocsProvider>
      </body>
    </html>
  );
};

export default Layout;
