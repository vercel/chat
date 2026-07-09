import { LogoAiElements } from "@vercel/geistdocs/assets/logos/logo-ai-elements";
import { LogoAiSdk } from "@vercel/geistdocs/assets/logos/logo-ai-sdk";
import { LogoEve } from "@vercel/geistdocs/assets/logos/logo-eve";
import { LogoFlagsSdk } from "@vercel/geistdocs/assets/logos/logo-flags-sdk";
import { LogoTurborepo } from "@vercel/geistdocs/assets/logos/logo-turborepo";
import { LogoWorkflowSdk } from "@vercel/geistdocs/assets/logos/logo-workflow-sdk";
import {
  defineConfig,
  type GeistdocsNavbarOssProduct,
} from "@vercel/geistdocs/config";
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

const navbarOssProducts: GeistdocsNavbarOssProduct[] = [
  { href: "https://eve.dev", logo: <LogoEve height={12} /> },
  { href: "https://ai-sdk.dev/", logo: <LogoAiSdk height={12} /> },
  { href: "https://flags-sdk.dev/", logo: <LogoFlagsSdk height={20} /> },
  { href: "https://workflow-sdk.dev/", logo: <LogoWorkflowSdk height={12} /> },
  { href: "https://turborepo.dev/", logo: <LogoTurborepo height={14} /> },
  { href: "https://elements.ai-sdk.dev/", logo: <LogoAiElements height={12} /> },
];

export const config = defineConfig({
  title,
  agent,
  defaultLanguage: "en",
  logo: <Logo />,
  github,
  nav,
  navbarOssProducts,
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
