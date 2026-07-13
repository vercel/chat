import "../global.css";
import { Footer } from "@vercel/geistdocs/footer";
import { Navbar } from "@vercel/geistdocs/navbar";
import type { Metadata } from "next";
import { GeistdocsProvider } from "@/components/geistdocs/provider";
import { config } from "@/lib/geistdocs/config";
import { mono, sans } from "@/lib/geistdocs/fonts";
import { cn } from "@/lib/utils";

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

const Layout = async ({ children, params }: LayoutProps<"/[lang]">) => {
  const { lang } = await params;

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
          <Footer config={config} />
        </GeistdocsProvider>
      </body>
    </html>
  );
};

export default Layout;
