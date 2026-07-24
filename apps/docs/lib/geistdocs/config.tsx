import { defineConfig } from "@vercel/geistdocs/config";
import {
  agent,
  basePath,
  github,
  Logo,
  nav,
  prompt,
  siteId,
  suggestions,
  title,
  translations,
} from "@/geistdocs";

export const config = defineConfig({
  title,
  agent,
  defaultLanguage: "en",
  logo: <Logo />,
  github,
  nav,
  // This is the Chat SDK site, so hide Chat SDK from the OSS flyout.
  navbarActiveProduct: "chat-sdk",
  basePath,
  siteId,
  translations,
  content: [
    { id: "docs", label: "Docs", dir: "content/docs", route: "/docs" },
    {
      id: "adapters",
      label: "Adapters",
      dir: "content/adapters",
      route: "/adapters",
    },
  ],
  ai: {
    prompt,
    suggestions,
  },
});
