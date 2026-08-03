import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CardSnippet } from "./card-snippet";

interface Integration {
  description: string;
  href: string;
  pkg: string;
  title: ReactNode;
}

const integrations: Integration[] = [
  {
    title: "AI SDK",
    description:
      "Build AI agents with streaming, tool calls, and structured outputs.",
    pkg: "npm i ai",
    href: "https://ai-sdk.dev",
  },
  {
    title: "Vercel AI Gateway",
    description: "Access 100+ models with one API key and no markup.",
    pkg: "npm i ai",
    href: "https://vercel.com/ai-gateway",
  },
  {
    title: "Vercel Sandbox",
    description:
      "Build knowledge agents with persistent filesystems to search, index, and read files.",
    pkg: "npm i @vercel/sandbox",
    href: "https://vercel.com/sandbox",
  },
  {
    title: (
      <span className="flex items-center gap-2">
        Workflows <Badge>NEW</Badge>
      </span>
    ),
    description:
      "Build durable chat agents that suspend, resume, and survive function timeouts.",
    pkg: "npm i workflow",
    href: "https://vercel.com/workflow",
  },
];

export const IntegrationsSection = () => (
  <div className="py-10 lg:py-12">
    {/* Heading left, paragraph right and bottom-aligned, as on vercel.com/ai-sdk. */}
    <div className="grid grid-cols-12 items-end gap-x-8 gap-y-10 lg:gap-x-12">
      <h2 className="col-span-12 text-balance text-gray-1000 text-heading-20 sm:text-heading-24 md:text-heading-32 lg:col-span-4 lg:text-heading-40">
        Scale with confidence
      </h2>
      <p className="col-span-12 text-pretty text-copy-16 text-gray-900 lg:col-span-5 lg:col-start-8 lg:text-copy-18">
        Plug Chat SDK into an entire ecosystem designed for AI-native chat
        experiences that scale.
      </p>
    </div>
    <div className="mt-10 grid grid-cols-12 gap-4 lg:gap-x-6">
      {integrations.map((integration) => (
        <a
          className="col-span-12 flex flex-col gap-8 rounded-xs border border-gray-300 border-solid p-8 no-underline outline-none transition-colors hover:border-gray-500 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 has-[[data-card-snippet]:hover]:border-gray-300 md:col-span-6 lg:col-span-3"
          href={integration.href}
          key={integration.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <div className="flex h-full flex-col justify-between gap-2 lg:gap-3">
            <div className="flex flex-col gap-3">
              <span className="flex items-center gap-2 font-medium! text-gray-1000 text-heading-16 sm:text-heading-20">
                {integration.title}
              </span>
              <span className="max-w-[32ch] text-balance text-copy-16 text-gray-900">
                {integration.description}
              </span>
            </div>
            <CardSnippet text={integration.pkg} />
          </div>
        </a>
      ))}
    </div>
  </div>
);
