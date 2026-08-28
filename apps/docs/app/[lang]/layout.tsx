import "../global.css";
import { Footer } from "@vercel/geistdocs/footer";
import { Navbar } from "@vercel/geistdocs/navbar";
import type { Metadata } from "next";
import { GeistdocsProvider } from "@/components/geistdocs/provider";
import { config } from "@/lib/geistdocs/config";
import { mono, sans } from "@/lib/geistdocs/fonts";
import { i18n } from "@/lib/geistdocs/i18n";
import { getRootLang } from "@/lib/geistdocs/root-params";
import { cn } from "@/lib/utils";

export const generateStaticParams = () =>
  i18n.languages.map((lang) => ({ lang }));

export const metadata: Metadata = {
  metadataBase: new URL("https://chat-sdk.dev"),
  title: {
    template: "%s | Chat SDK",
    default: "Chat SDK",
  },
  openGraph: {
    title: {
      template: "%s | Chat SDK",
      default: "Chat SDK",
    },
    images: "/opengraph-image.png",
  },
};

const Layout = async ({ children }: LayoutProps<"/[lang]">) => {
  const lang = await getRootLang();

  return (
    <html
      className={cn(sans.variable, sans.className, mono.variable, "antialiased")}
      lang={lang}
      suppressHydrationWarning
    >
      <head>
        <link href="/llms.txt" rel="llms-txt" />
      </head>
      <body>
        <GeistdocsProvider basePath={config.basePath} lang={lang}>
          <Navbar config={config} />
          {children}
          <Footer />
        </GeistdocsProvider>
      </body>
    </html>
  );
};

export default Layout;
